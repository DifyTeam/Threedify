// BVH.js - Sistema de Aceleração Espacial

class BVHNode {
    constructor() {
        this.boundingBox = new THREE.Box3();
        this.left = null;
        this.right = null;
        this.triangles = []; // Armazena índices dos triângulos (apenas para nós folha)
    }
}

class MeshBVH {
    constructor(mesh) {
        this.mesh = mesh;
        this.geometry = mesh.geometry;
        
        // Garante que temos os dados necessários
        if (!this.geometry.index) {
            console.warn("BVH: Geometria sem índice detectada. A performance pode variar.");
        }

        this.root = null;
        this.maxTrianglesPerNode = 10;
        this.maxDepth = 40;
        
        this.build();
    }

    build() {
        // console.time("BVH Build");
        
        const posAttr = this.geometry.attributes.position;
        const indexAttr = this.geometry.index;
        const triangles = [];
        
        const vA = new THREE.Vector3();
        const vB = new THREE.Vector3();
        const vC = new THREE.Vector3();

        const count = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;

        for (let i = 0; i < count; i++) {
            let a, b, c;
            
            if (indexAttr) {
                a = indexAttr.getX(i * 3);
                b = indexAttr.getX(i * 3 + 1);
                c = indexAttr.getX(i * 3 + 2);
            } else {
                a = i * 3;
                b = i * 3 + 1;
                c = i * 3 + 2;
            }

            vA.fromBufferAttribute(posAttr, a);
            vB.fromBufferAttribute(posAttr, b);
            vC.fromBufferAttribute(posAttr, c);

            const centroid = vA.clone().add(vB).add(vC).multiplyScalar(1/3);
            
            const box = new THREE.Box3();
            box.expandByPoint(vA);
            box.expandByPoint(vB);
            box.expandByPoint(vC);

            triangles.push({
                index: i * 3,
                centroid: centroid,
                box: box,
                a: a, b: b, c: c
            });
        }

        this.root = this.splitNodes(triangles, 0);
        // console.timeEnd("BVH Build");
    }

    splitNodes(triangles, depth) {
        const node = new BVHNode();
        
        for (let t of triangles) {
            node.boundingBox.union(t.box);
        }

        if (triangles.length <= this.maxTrianglesPerNode || depth >= this.maxDepth) {
            node.triangles = triangles;
            return node;
        }

        const size = new THREE.Vector3();
        node.boundingBox.getSize(size);
        const axis = size.x > size.y ? (size.x > size.z ? 'x' : 'z') : (size.y > size.z ? 'y' : 'z');

        triangles.sort((a, b) => a.centroid[axis] - b.centroid[axis]);

        const mid = Math.floor(triangles.length / 2);
        const leftTris = triangles.slice(0, mid);
        const rightTris = triangles.slice(mid);

        node.left = this.splitNodes(leftTris, depth + 1);
        node.right = this.splitNodes(rightTris, depth + 1);

        return node;
    }

    raycast(raycaster, intersects) {
        const inverseMatrix = new THREE.Matrix4().copy(this.mesh.matrixWorld).invert();
        const localRay = raycaster.ray.clone().applyMatrix4(inverseMatrix);

        this.traverseRay(this.root, localRay, raycaster, intersects);
        
        intersects.sort((a, b) => a.distance - b.distance);
    }

    traverseRay(node, ray, raycaster, intersects) {
        if (!node) return;

        if (!ray.intersectsBox(node.boundingBox)) return;

        if (node.triangles.length > 0) {
            const posAttr = this.geometry.attributes.position;
            const vA = new THREE.Vector3();
            const vB = new THREE.Vector3();
            const vC = new THREE.Vector3();
            const intersectionPoint = new THREE.Vector3();

            for (let t of node.triangles) {
                vA.fromBufferAttribute(posAttr, t.a);
                vB.fromBufferAttribute(posAttr, t.b);
                vC.fromBufferAttribute(posAttr, t.c);

                const intersect = ray.intersectTriangle(vA, vB, vC, true, intersectionPoint);

                if (intersect) {
                    const worldPoint = intersectionPoint.clone().applyMatrix4(this.mesh.matrixWorld);
                    const distance = raycaster.ray.origin.distanceTo(worldPoint);

                    if (distance < raycaster.near || distance > raycaster.far) continue;

                    intersects.push({
                        distance: distance,
                        point: worldPoint,
                        object: this.mesh,
                        face: { a: t.a, b: t.b, c: t.c, normal: new THREE.Vector3() },
                        faceIndex: t.index / 3
                    });
                }
            }
        } else {
            this.traverseRay(node.left, ray, raycaster, intersects);
            this.traverseRay(node.right, ray, raycaster, intersects);
        }
    }
}