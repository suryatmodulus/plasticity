import * as THREE from "three";
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import c3d from '../../../build/Release/c3d.node';
import { EditorSignals } from '../../Editor';
import { GeometryDatabase } from '../../GeometryDatabase';
import MaterialDatabase from '../../MaterialDatabase';
import { CircleGeometry } from '../../util/Util';
import { GeometryFactory } from '../Factory';
import * as visual from '../../../src/VisualModel';

export default class LoftFactory extends GeometryFactory {
    contours!: visual.SpaceInstance<visual.Curve3D>[];
    spine?: visual.SpaceInstance<visual.Curve3D>;

    constructor(db: GeometryDatabase, materials: MaterialDatabase, signals: EditorSignals) {
        super(db, materials, signals);
    }

    async doUpdate() {
    }

    async doCommit() {
        const contours = [], placements = [];
        for (const c of this.contours) {
            const inst = this.db.lookup(c);
            const item = inst.GetSpaceItem();
            const curve = item.Cast<c3d.Curve3D>(c3d.SpaceType.Curve3D);
            const { curve2d, placement } = curve.GetPlaneCurve(false);
            const contour = new c3d.Contour([curve2d], true);
            contours.push(contour);
            placements.push(placement);
        };
        // const inst = this.db.lookup(this.spine);
        // const item = inst.GetSpaceItem();
        // const spine = item.Cast<c3d.Curve3D>(c3d.SpaceType.Curve3D);

        const names = new c3d.SNameMaker(c3d.CreatorType.CurveLoftedSolid, c3d.ESides.SideNone, 0);
        const ns = [new c3d.SNameMaker(0, c3d.ESides.SidePlus, 0)];
        const params = new c3d.LoftedValues();
        const solid = c3d.ActionSolid.LoftedSolid(placements, contours, null, params, [], names, ns);
        
        const r = await this.db.addItem(solid);
        return r;
    }

    doCancel() {
        return super.cancel();
    }
}