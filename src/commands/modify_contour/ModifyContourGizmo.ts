import { CompositeDisposable, Disposable } from "event-kit";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2";
import { Viewport } from "../../components/viewport/Viewport";
import { CancellablePromise } from "../../util/Cancellable";
import { AbstractGizmo, EditorLike, GizmoStateMachine, GizmoTriggerStrategy, Intersector, Mode, MovementInfo } from "../AbstractGizmo";
import { CompositeGizmo } from "../CompositeGizmo";
import { AbstractAxialScaleGizmo, AbstractAxisGizmo, arrowGeometry, AxisHelper, DashedLineMagnitudeHelper, lineGeometry, MagnitudeStateMachine, sphereGeometry } from "../MiniGizmos";
import { ModifyContourParams } from "./ModifyContourFactory";

const Y = new THREE.Vector3(0, 1, 0);

export class ModifyContourGizmo extends CompositeGizmo<ModifyContourParams> {
    private readonly filletAll = new FilletCornerGizmo("modify-contour:fillet-all", this.editor, true);
    private readonly segments: PushCurveGizmo[] = [];
    private readonly corners: FilletCornerGizmo[] = [];

    private readonly segmentTrigger = new AdvancedGizmoTriggerStrategy("modify-contour:segment", this.editor);
    private readonly filletTrigger = new AdvancedGizmoTriggerStrategy("modify-contour:fillet", this.editor);

    constructor(params: ModifyContourParams, editor: EditorLike) {
        super(params, editor);

        for (const _ of params.segmentAngles) {
            const gizmo = new PushCurveGizmo("modify-contour:segment", this.editor);
            gizmo.trigger = this.segmentTrigger;
            this.segments.push(gizmo);
        }

        for (const corner of params.cornerAngles) {
            const gizmo = new FilletCornerGizmo("modify-contour:fillet", this.editor);
            gizmo.userData.index = corner.index;
            gizmo.trigger = this.filletTrigger;
            this.corners.push(gizmo);
        }
    }

    prepare() {
        const { filletAll, segments, corners, params } = this;

        filletAll.visible = false;

        for (const segment of segments) segment.relativeScale.setScalar(0.8);

        const quat = new THREE.Quaternion();
        for (const [i, segment] of params.segmentAngles.entries()) {
            const gizmo = this.segments[i];
            gizmo.relativeScale.setScalar(0.5);
            quat.setFromUnitVectors(Y, segment.normal);
            gizmo.quaternion.copy(quat);
            gizmo.position.copy(segment.origin);
        }

        const centroid = new THREE.Vector3();
        for (const [i, corner] of params.cornerAngles.entries()) {
            const gizmo = this.corners[i];
            gizmo.relativeScale.setScalar(0.8);
            quat.setFromUnitVectors(Y, corner.tau.cross(corner.axis));
            gizmo.quaternion.copy(quat);
            gizmo.position.copy(corner.origin);
            centroid.add(corner.origin);
        }

        if (params.cornerAngles.length > 0) {
            centroid.divideScalar(params.cornerAngles.length);
            filletAll.position.copy(centroid);
        }

        this.add(filletAll);
        for (const segment of segments) this.add(segment);
        for (const corner of corners) this.add(corner);
    }

    execute(cb: (params: ModifyContourParams) => void, mode: Mode = Mode.None): CancellablePromise<void> {
        const { filletAll, segments, params, corners } = this;
        const { segmentTrigger, filletTrigger } = this;

        const disposable = new CompositeDisposable();
        disposable.add(segmentTrigger.execute());
        disposable.add(filletTrigger.execute());

        for (const [i, segment] of segments.entries()) {
            this.addGizmo(segment, d => {
                this.disableCorners();
                this.disableSegments(segment);

                params.mode = 'offset';
                params.segment = i;
                params.distance = d;
            });
        }


        if (params.cornerAngles.length > 0) {
            this.addGizmo(filletAll, d => {
                this.disableSegments();

                params.mode = 'fillet';
                for (const [i, corner] of params.cornerAngles.entries()) {
                    params.radiuses[corner.index] = d;
                    corners[i].value = d;
                }
            });
        }

        for (const corner of corners) {
            this.addGizmo(corner, d => {
                this.disableSegments();

                params.mode = 'fillet';
                params.radiuses[corner.userData.index] = d;
            });
        }

        return super.execute(cb, mode, disposable);
    }

    private disableSegments(except?: PushCurveGizmo) {
        for (const segment of this.segments) {
            if (segment === except) continue;
            segment.stateMachine!.isEnabled = false;
            segment.visible = false;
        }
    }

    private disableCorners() {
        if (this.corners.length > 0) this.filletAll.stateMachine!.isEnabled = false;
        for (const corners of this.corners) {
            corners.stateMachine!.isEnabled = false;
            corners.visible = false;
        }
    }

    get shouldRescaleOnZoom() { return false }
}

class PushCurveGizmo extends AbstractAxisGizmo {
    readonly state = new MagnitudeStateMachine(0, false);
    protected material = this.editor.gizmos.default;
    readonly helper = new AxisHelper(this.material.line);
    readonly tip = new THREE.Mesh(arrowGeometry, this.editor.gizmos.default.mesh);
    protected readonly shaft = new Line2(lineGeometry, this.editor.gizmos.default.line2);
    protected readonly knob = new THREE.Mesh(new THREE.SphereGeometry(0.2), this.editor.gizmos.invisible);
    protected readonly hasCommand = false;

    constructor(name: string, editor: EditorLike) {
        super(name, editor);
        this.setup();
        this.add(this.helper);
    }

    // render(length: number) { super.render(-length - 0.35) }

    protected accumulate(original: number, sign: number, dist: number): number {
        return original + dist
    }

    get shouldRescaleOnZoom() { return true }
}

export class FilletCornerGizmo extends AbstractAxialScaleGizmo {
    handleLength = -0.35;
    readonly state = new MagnitudeStateMachine(0);
    readonly tip: THREE.Mesh<any, any> = new THREE.Mesh(sphereGeometry, this.material.mesh);
    protected readonly shaft = new Line2(lineGeometry, this.material.line2);
    protected readonly knob = new THREE.Mesh(new THREE.SphereGeometry(0.2), this.editor.gizmos.invisible);

    constructor(name: string, editor: EditorLike, protected readonly hasCommand = false) {
        super(name, editor, editor.gizmos.default);
        this.setup();
    }

    protected accumulate(original: number, dist: number, denom: number, sign: number = 1): number {
        return Math.max(0, sign * (original + dist - denom))
    }

    get shouldRescaleOnZoom() { return true }
}

interface GizmoInfo<T> {
    gizmo: AbstractGizmo<T>;
    addEventHandlers: () => Disposable;
}
class AdvancedGizmoTriggerStrategy<T> implements GizmoTriggerStrategy<T> {
    private readonly map: GizmoInfo<T>[] = [];
    private readonly raycaster = new THREE.Raycaster();

    constructor(private readonly title: string, private readonly editor: EditorLike) { }

    execute(): Disposable {
        const disposable = new CompositeDisposable();
        let winner: GizmoInfo<T> | undefined = undefined;
        for (const viewport of this.editor.viewports) {
            const { renderer: { domElement } } = viewport;

            const onPointerDown = (event: PointerEvent) => {
                if (winner === undefined) return;
                winner.gizmo.stateMachine!.update(viewport, event);
                winner.gizmo.stateMachine!.pointerDown(() => {
                    domElement.ownerDocument.body.setAttribute("gizmo", this.title);
                    viewport.disableControls();
                    return winner!.addEventHandlers();
                });
            }

            const onPointerHover = (event: PointerEvent) => {
                const camera = viewport.camera;
                const pointer = AbstractGizmo.getPointer(domElement, event);
                this.raycaster.setFromCamera(pointer, camera);
                if (winner !== undefined) {
                    winner.gizmo.stateMachine!.update(viewport, event);
                    winner.gizmo.stateMachine!.pointerHover();
                }
                let newWinner = undefined;
                for (const info of this.map) {
                    const { gizmo } = info;
                    const intersection = GizmoStateMachine.intersectObjectWithRay(gizmo.picker, this.raycaster, true);
                    if (intersection !== undefined) {
                        newWinner = info;
                        break;
                    }
                }
                if (newWinner === undefined) return;
                if (newWinner === winner) return;
                winner = newWinner;
                winner.gizmo.stateMachine!.update(viewport, event);
                winner.gizmo.stateMachine!.pointerHover();
            }

            domElement.addEventListener('pointerdown', onPointerDown);
            domElement.addEventListener('pointermove', onPointerHover);
            disposable.add(new Disposable(() => {
                domElement.removeEventListener('pointerdown', onPointerDown);
                domElement.removeEventListener('pointermove', onPointerHover);
            }));
        }
        return disposable;
    }

    register(gizmo: AbstractGizmo<T>, viewport: Viewport, addEventHandlers: () => Disposable): Disposable {
        this.map.push({ gizmo, addEventHandlers });
        return new Disposable();
    }
}