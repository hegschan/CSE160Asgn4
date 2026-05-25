class Camera {
    constructor() {
        this.near = 0.1;
        this.far = 1000;
        this.fov = 60;

        this.eye = new Vector3([0, 0, 5]);
        this.center = new Vector3([0, 0, 0]);
        this.up = new Vector3([0, 1, 0]);

        this.projMatrix = new Matrix4();
        this.projMatrix.setPerspective(this.fov, canvas.width/canvas.height, this.near, this.far);

        this.viewMatrix = new Matrix4();
        this.updateView();
    }

    moveForward(scale) {
        // Compute forward vector
        let forward = new Vector3(this.center.elements);
        forward.sub(this.eye);
        forward.normalize();
        forward.mul(scale);

        // Add forward vector to eye and center
        this.eye.add(forward);
        this.center.add(forward);

        this.updateView();
    }

    zoom(scale) {
        this.projMatrix.setPerspective(this.fov * scale, canvas.width/canvas.height, this.near, this.far);
    }

    moveSideways(scale) {
        //1. Calculate forward vector: center - eye
        let forward = new Vector3(this.center.elements);
        forward.sub(this.eye);

        //2. Calculate right vetor: up x forward
        let right = Vector3.cross(forward, this.up)
        right.normalize();
        right.mul(scale);

        console.log(right);
    }

    pan(angle) {
        let rotMatrix = new Matrix4();
        rotMatrix.setRotate(angle, this.up.elements[0],
                                   this.up.elements[1],
                                   this.up.elements[2]);

        let forward = new Vector3(this.center.elements);
        forward.sub(this.eye);

        let forward_prime = rotMatrix.multiplyVector3(forward);
        this.center.set(this.eye.elements);
        this.center.add(forward_prime);

        this.updateView();
    }

    tilt(angle) {
        let forward = new Vector3(this.center.elements);
        forward.sub(this.eye);

        let right = Vector3.cross(forward, this.up);
        right.normalize();

        let rotMatrix = new Matrix4();
        rotMatrix.setRotate(angle, right.elements[0],
                                   right.elements[1],
                                   right.elements[2]);

        let forward_prime = rotMatrix.multiplyVector3(forward);
        this.center.set(this.eye.elements);
        this.center.add(forward_prime);

        let up_prime = rotMatrix.multiplyVector3(this.up);
        this.up.set(up_prime);
        this.up.normalize();

        this.updateView();
    }

    updateView() {
        this.viewMatrix.setLookAt(
            this.eye.elements[0],
            this.eye.elements[1],
            this.eye.elements[2],
            this.center.elements[0],
            this.center.elements[1],
            this.center.elements[2],
            this.up.elements[0],
            this.up.elements[1],
            this.up.elements[2]
        );
    }
}