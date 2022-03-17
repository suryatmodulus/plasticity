import c3d from '../../../build/Release/c3d.node';
import { DatabaseLike } from "../../editor/DatabaseLike";
import { PlaneDatabase } from "../../editor/PlaneDatabase";
import { ConstructionPlaneSnap, FaceConstructionPlaneSnap } from "../../editor/snaps/ConstructionPlaneSnap";
import { FaceSnap } from "../../editor/snaps/Snap";
import { SnapManager } from "../../editor/snaps/SnapManager";
import { HasSelection } from '../../selection/SelectionDatabase';
import { point2point, vec2vec } from "../../util/Conversion";
import * as visual from '../../visual_model/VisualModel';
import { NavigationTarget } from './ViewportGeometryNavigator';
import { Orientation } from "./ViewportNavigator";

export class ConstructionPlaneGenerator {
    constructor(private readonly db: DatabaseLike, private readonly planes: PlaneDatabase, private readonly snaps: SnapManager) { }

    constructionPlaneForSelection(selection: HasSelection): NavigationTarget | undefined {
        if (selection.faces.size > 0) {
            return this.constructionPlaneForFace(selection.faces.first);
        } else if (selection.regions.size > 0) {
            return this.constructionPlaneForRegion(selection.regions.first);
        } else return;
    }

    constructionPlaneForRegion(to: visual.PlaneInstance<visual.Region>): NavigationTarget {
        const { db, planes } = this;
        const model = db.lookup(to);
        const placement = model.GetPlacement();
        const normal = vec2vec(placement.GetAxisZ(), 1);
        const cube = new c3d.Cube();
        model.AddYourGabaritTo(cube);
        const min = point2point(cube.pmin), max = point2point(cube.pmax);
        const target = min.add(max).multiplyScalar(0.5);
        const cplane = planes.temp(new ConstructionPlaneSnap(normal, target));
        return { tag: 'region', target: to, cplane }
    }

    constructionPlaneForFace(to: visual.Face): NavigationTarget {
        const { db, planes, snaps } = this;
        const model = db.lookupTopologyItem(to);
        const placement = model.GetControlPlacement();
        model.OrientPlacement(placement);
        placement.Normalize(); // FIXME: for some reason necessary with curved faces
        const normal = vec2vec(placement.GetAxisY(), 1);
        const target = point2point(model.Point(0.5, 0.5));
        const faceSnap = snaps.identityMap.lookup(to) as FaceSnap;
        const cplane = planes.temp(new FaceConstructionPlaneSnap(normal, target, undefined, faceSnap));
        return { tag: 'face', target: to, cplane }
    }

    constructionPlaneForOrientation(to: Orientation): NavigationTarget {
        switch (to) {
            case Orientation.posX: return { tag: 'orientation', cplane: PlaneDatabase.YZ };
            case Orientation.posY: return { tag: 'orientation', cplane: PlaneDatabase.XZ };
            case Orientation.posZ: return { tag: 'orientation', cplane: PlaneDatabase.XY };
            case Orientation.negX: return { tag: 'orientation', cplane: PlaneDatabase.YZ };
            case Orientation.negY: return { tag: 'orientation', cplane: PlaneDatabase.XZ };
            case Orientation.negZ: return { tag: 'orientation', cplane: PlaneDatabase.XY };
        }
    }
}