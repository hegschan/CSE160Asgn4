class ObjModel extends Model {
    constructor(color, objText) {
        super(color);
        this.parse(objText);
    }

    parse(text) {
        const positions = [];
        const normals = [];
        const faces = [];

        const lines = text.split("\n");
        for (let line of lines) {
            line = line.trim();
            if (line.length === 0 || line.startsWith("#")) {
                continue;
            }

            const parts = line.split(/\s+/);
            const type = parts[0];

            if (type === "v") {
                positions.push(
                    parseFloat(parts[1]),
                    parseFloat(parts[2]),
                    parseFloat(parts[3])
                );
            } else if (type === "vn") {
                normals.push(
                    parseFloat(parts[1]),
                    parseFloat(parts[2]),
                    parseFloat(parts[3])
                );
            } else if (type === "f") {
                const faceVerts = [];
                for (let i = 1; i < parts.length; i++) {
                    const indices = parts[i].split("/");
                    faceVerts.push({
                        v: parseInt(indices[0], 10) - 1,
                        vn: indices.length > 2 && indices[2] !== ""
                            ? parseInt(indices[2], 10) - 1
                            : -1
                    });
                }
                faces.push(faceVerts);
            }
        }

        const vertexList = [];
        const normalList = [];
        const indexList = [];

        for (let face of faces) {
            const triangles = this.triangulate(face);
            for (let tri of triangles) {
                const p0 = [
                    positions[tri[0].v * 3],
                    positions[tri[0].v * 3 + 1],
                    positions[tri[0].v * 3 + 2]
                ];
                const p1 = [
                    positions[tri[1].v * 3],
                    positions[tri[1].v * 3 + 1],
                    positions[tri[1].v * 3 + 2]
                ];
                const p2 = [
                    positions[tri[2].v * 3],
                    positions[tri[2].v * 3 + 1],
                    positions[tri[2].v * 3 + 2]
                ];

                const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
                const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
                let nx = uy * vz - uz * vy;
                let ny = uz * vx - ux * vz;
                let nz = ux * vy - uy * vx;
                const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1.0;
                nx /= len;
                ny /= len;
                nz /= len;

                for (let corner of tri) {
                    const vIdx = corner.v;
                    vertexList.push(
                        positions[vIdx * 3],
                        positions[vIdx * 3 + 1],
                        positions[vIdx * 3 + 2]
                    );

                    if (corner.vn >= 0 && normals.length > 0) {
                        normalList.push(
                            normals[corner.vn * 3],
                            normals[corner.vn * 3 + 1],
                            normals[corner.vn * 3 + 2]
                        );
                    } else {
                        normalList.push(nx, ny, nz);
                    }

                    indexList.push(vertexList.length / 3 - 1);
                }
            }
        }

        this.vertices = new Float32Array(vertexList);
        this.normals = new Float32Array(normalList);
        this.indices = new Uint16Array(indexList);
    }

    triangulate(face) {
        if (face.length === 3) {
            return [face];
        }

        const triangles = [];
        for (let i = 1; i < face.length - 1; i++) {
            triangles.push([face[0], face[i], face[i + 1]]);
        }
        return triangles;
    }
}

function loadObjModel(url, color, onLoaded) {
    const request = new XMLHttpRequest();
    request.open("GET", url, true);
    request.onreadystatechange = function() {
        if (request.readyState === 4) {
            if (request.status === 200 || request.status === 0) {
                const model = new ObjModel(color, request.responseText);
                onLoaded(model);
            } else {
                console.log("Failed to load OBJ: " + url);
            }
        }
    };
    request.send(null);
}
