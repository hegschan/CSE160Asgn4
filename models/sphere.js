class Sphere extends Model {
    constructor(color) {
        super(color);
        let n = 16;

        let vertices1 = this.createVertices(n);
        this.vertices = new Float32Array(vertices1);

        let indices1 = this.createIndices(n);
        this.indices = new Uint16Array(indices1);

        this.normals = new Float32Array(vertices1);
    }

    createVertices(SPHERE_DIV) {
      let positions = [];

      for (let j = 0; j <= SPHERE_DIV; j++) {
        let aj = j * Math.PI / SPHERE_DIV;
        let sj = Math.sin(aj);
        let cj = Math.cos(aj);
        for (let i = 0; i <= SPHERE_DIV; i++) {
          let ai = i * 2 * Math.PI / SPHERE_DIV;
          let si = Math.sin(ai);
          let ci = Math.cos(ai);

          positions.push(si * sj);  // X
          positions.push(cj);       // Y
          positions.push(ci * sj);  // Z
        }
      }
      return positions;
    }

    createIndices(SPHERE_DIV) {
      let indices = [];

      for (let j = 0; j < SPHERE_DIV; j++) {
        for (let i = 0; i < SPHERE_DIV; i++) {
          let p1 = j * (SPHERE_DIV+1) + i;
          let p2 = p1 + (SPHERE_DIV+1);

          indices.push(p1);
          indices.push(p2);
          indices.push(p1 + 1);

          indices.push(p1 + 1);
          indices.push(p2);
          indices.push(p2 + 1);
        }
      }
      return indices;
    }
}
