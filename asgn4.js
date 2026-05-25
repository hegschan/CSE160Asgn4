// Phong calculated based on: https://en.wikipedia.org/wiki/Phong_reflection_model

let VSHADER = `
    precision mediump float;
    attribute vec3 a_Position;
    attribute vec3 a_Normal;

    uniform mat4 u_ModelMatrix;
    uniform mat4 u_ViewMatrix;
    uniform mat4 u_ProjMatrix;
    uniform mat4 u_NormalMatrix;

    varying vec3 v_Normal;
    varying vec4 v_WorldPos;

    void main() {
        v_WorldPos = u_ModelMatrix * vec4(a_Position, 1.0);
        v_Normal = normalize((u_NormalMatrix * vec4(a_Normal, 0.0)).xyz);
        gl_Position = u_ProjMatrix * u_ViewMatrix * v_WorldPos;
    }
`;

let FSHADER = `
    precision mediump float;

    uniform vec3 u_Color;
    uniform vec3 u_ambientColor;
    uniform vec3 u_diffuseColor;
    uniform vec3 u_specularColor;
    uniform vec3 u_lightColor;

    uniform vec3 u_pointLightPos;
    uniform vec3 u_spotLightPos;
    uniform vec3 u_spotDirection;
    uniform float u_spotCosCutoff;
    uniform float u_spotExponent;

    uniform vec3 u_eyePosition;
    uniform bool u_useLighting;
    uniform bool u_showNormals;
    uniform bool u_pointLightOn;
    uniform bool u_spotLightOn;

    varying vec3 v_Normal;
    varying vec4 v_WorldPos;

    vec3 calcAmbient() {
        return u_ambientColor * u_Color;
    }

    vec3 calcDiffuse(vec3 l, vec3 n) {
        float nDotL = max(dot(l, n), 0.0);
        return u_diffuseColor * u_Color * nDotL;
    }

    vec3 calcSpecular(vec3 l, vec3 n, vec3 v) {
        vec3 r = reflect(-l, n);
        float rDotV = max(dot(r, v), 0.0);
        return u_specularColor * u_Color * pow(rDotV, 32.0);
    }

    float spotFactor(vec3 l, vec3 spotDir) {
        vec3 d = normalize(spotDir);
        float spotCosine = dot(-d, l);
        if (spotCosine < u_spotCosCutoff) {
            return 0.0;
        }
        return pow(spotCosine, u_spotExponent);
    }

    vec3 phongFromLight(vec3 lightPos, bool isSpotlight) {
        vec3 n = normalize(v_Normal);
        vec3 l = normalize(lightPos - v_WorldPos.xyz);
        vec3 v = normalize(u_eyePosition - v_WorldPos.xyz);

        float factor = 1.0;
        if (isSpotlight) {
            factor = spotFactor(l, u_spotDirection);
        }

        vec3 diffuse = calcDiffuse(l, n) * factor;
        vec3 specular = calcSpecular(l, n, v) * factor;
        return (diffuse + specular) * u_lightColor;
    }

    void main() {
        if (u_showNormals) {
            gl_FragColor = vec4(v_Normal * 0.5 + 0.5, 1.0);
            return;
        }

        if (!u_useLighting) {
            gl_FragColor = vec4(u_Color, 1.0);
            return;
        }

        vec3 color = calcAmbient();
        if (u_pointLightOn) {
            color += phongFromLight(u_pointLightPos, false);
        }
        if (u_spotLightOn) {
            color += phongFromLight(u_spotLightPos, true);
        }

        if (!u_pointLightOn && !u_spotLightOn) {
            color = calcAmbient();
        }

        gl_FragColor = vec4(color, 1.0);
    }
`;

let gl = null;
let canvas = null;
let camera = null;

let modelMatrix = new Matrix4();
let normalMatrix = new Matrix4();

let models = [];

let vertexBuffer = null;
let normalBuffer = null;
let indexBuffer = null;

let lightAngleOffset = 0;
let lightRadius = 3.0;
let lightHeight = 2.0;
let pointLightPos = new Vector3([0.0, lightHeight, lightRadius]);
let spotLightPos = new Vector3([-2.0, 3.0, 1.0]);
let spotDirection = new Vector3([0.0, -1.0, 0.0]);
let lightColor = [1.0, 1.0, 1.0];

let useLighting = true;
let showNormals = false;
let pointLightOn = true;
let spotLightOn = true;
let lastCameraPan = 0;
let lastCameraTilt = 0;

let eagleCubeGeo = null;
let eaglePyramidGeo = null;
let eagleModelStack = [];
let g_eagleStartTime = 0;

const g_eagleJoint = {
    neck: 0,
    head: 0,
    beak: 0,
    tail: 0,
    leftShoulder: 10,
    leftElbow: -10,
    leftWrist: 10,
    rightShoulder: -10,
    rightElbow: 10,
    rightWrist: -10,
    leftHip: 0,
    leftKnee: 0,
    rightHip: 0,
    rightKnee: 0
};

const EAGLE_WORLD = {
    x: -3.3,
    y: -0.45,
    z: -3.3,
    yaw: 35,
    scale: 0.48
};

let u_ModelMatrix = null;
let u_ViewMatrix = null;
let u_ProjMatrix = null;
let u_NormalMatrix = null;
let u_Color = null;
let u_ambientColor = null;
let u_diffuseColor = null;
let u_specularColor = null;
let u_lightColor = null;
let u_pointLightPos = null;
let u_spotLightPos = null;
let u_spotDirection = null;
let u_spotCosCutoff = null;
let u_spotExponent = null;
let u_eyePosition = null;
let u_useLighting = null;
let u_showNormals = null;
let u_pointLightOn = null;
let u_spotLightOn = null;

function drawModel(model) {
    modelMatrix.setIdentity();
    modelMatrix.translate(model.translate[0], model.translate[1], model.translate[2]);
    modelMatrix.rotate(model.rotate[0], 1, 0, 0);
    modelMatrix.rotate(model.rotate[1], 0, 1, 0);
    modelMatrix.rotate(model.rotate[2], 0, 0, 1);
    modelMatrix.scale(model.scale[0], model.scale[1], model.scale[2]);
    gl.uniformMatrix4fv(u_ModelMatrix, false, modelMatrix.elements);

    normalMatrix.setInverseOf(modelMatrix);
    normalMatrix.transpose();
    gl.uniformMatrix4fv(u_NormalMatrix, false, normalMatrix.elements);

    gl.uniform3f(u_Color, model.color[0], model.color[1], model.color[2]);

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, model.vertices, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, model.normals, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, model.indices, gl.STATIC_DRAW);

    gl.drawElements(gl.TRIANGLES, model.indices.length, gl.UNSIGNED_SHORT, 0);
}

function initBuffer(attributeName, n) {
    let shaderBuffer = gl.createBuffer();
    if (!shaderBuffer) {
        console.log("Can't create buffer.");
        return -1;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, shaderBuffer);
    let shaderAttribute = gl.getAttribLocation(gl.program, attributeName);
    gl.vertexAttribPointer(shaderAttribute, n, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(shaderAttribute);
    return shaderBuffer;
}

function updatePointLightPosition() {
    let t = Date.now() * 0.001 + lightAngleOffset * Math.PI / 180.0;
    pointLightPos.elements[0] = lightRadius * Math.cos(t);
    pointLightPos.elements[1] = lightHeight;
    pointLightPos.elements[2] = lightRadius * Math.sin(t);
}

function initEagle() {
    eagleCubeGeo = new UnitCube([1.0, 1.0, 1.0]);
    eaglePyramidGeo = new Pyramid([1.0, 1.0, 1.0]);
    g_eagleStartTime = Date.now();
}

function eaglePushMatrix(m) {
    eagleModelStack.push(new Matrix4(m));
}

function eaglePopMatrix() {
    return eagleModelStack.pop();
}

function drawEagleGeometry(geo, mat, color) {
    gl.uniformMatrix4fv(u_ModelMatrix, false, mat.elements);
    normalMatrix.setInverseOf(mat);
    normalMatrix.transpose();
    gl.uniformMatrix4fv(u_NormalMatrix, false, normalMatrix.elements);
    gl.uniform3f(u_Color, color[0], color[1], color[2]);

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geo.vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geo.normals, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.STATIC_DRAW);
    gl.drawElements(gl.TRIANGLES, geo.indices.length, gl.UNSIGNED_SHORT, 0);
}

function drawEagleCube(mat, color) {
    drawEagleGeometry(eagleCubeGeo, mat, color);
}

function drawEaglePyramid(mat, color) {
    drawEagleGeometry(eaglePyramidGeo, mat, color);
}

function updateEagleAnimation() {
    let t = (Date.now() - g_eagleStartTime) / 1000.0;
    let flap = 35 * Math.sin(t * 5.0);
    let elbowWave = 18 * Math.sin(t * 5.0 + 0.8);
    let wristWave = 12 * Math.sin(t * 5.0 + 1.4);

    g_eagleJoint.leftShoulder = 10 + flap;
    g_eagleJoint.rightShoulder = -10 - flap;
    g_eagleJoint.leftElbow = -10 + elbowWave;
    g_eagleJoint.rightElbow = 10 - elbowWave;
    g_eagleJoint.leftWrist = 8 + wristWave;
    g_eagleJoint.rightWrist = -8 - wristWave;

    g_eagleJoint.neck = 10 * Math.sin(t * 1.6);
    g_eagleJoint.head = 6 * Math.sin(t * 2.2);
    g_eagleJoint.tail = 14 * Math.sin(t * 2.0 + 2.2);
    g_eagleJoint.leftHip = 12 * Math.sin(t * 3.5);
    g_eagleJoint.rightHip = -12 * Math.sin(t * 3.5);
    g_eagleJoint.leftKnee = 8 * Math.sin(t * 3.5 + 0.5);
    g_eagleJoint.rightKnee = -8 * Math.sin(t * 3.5 + 0.5);
    g_eagleJoint.beak = 6 * Math.max(0, Math.sin(t * 4.0));
}

function drawEagleWing(root, x, y, z, left) {
    let shoulder = new Matrix4(root);
    shoulder.translate(x, y, z);
    shoulder.rotate(left ? g_eagleJoint.leftShoulder : g_eagleJoint.rightShoulder, 0, 0, 1);
    eaglePushMatrix(shoulder);

    let upper = new Matrix4(shoulder);
    upper.scale(1.1, 0.2, 0.35);
    drawEagleCube(upper, [0.29, 0.18, 0.10]);

    let elbow = eaglePopMatrix();
    elbow.translate(1.05, 0.05, 0.0);
    elbow.rotate(left ? g_eagleJoint.leftElbow : g_eagleJoint.rightElbow, 0, 0, 1);
    eaglePushMatrix(elbow);

    let fore = new Matrix4(elbow);
    fore.scale(1.0, 0.16, 0.32);
    drawEagleCube(fore, [0.22, 0.14, 0.08]);

    let wrist = eaglePopMatrix();
    wrist.translate(0.95, 0.02, 0.0);
    wrist.rotate(left ? g_eagleJoint.leftWrist : g_eagleJoint.rightWrist, 0, 0, 1);

    let tip = new Matrix4(wrist);
    tip.scale(0.85, 0.12, 0.3);
    drawEagleCube(tip, [0.17, 0.11, 0.07]);
}

function drawEagleLeg(root, x, y, z, left) {
    let hip = new Matrix4(root);
    hip.translate(x, y, z);
    hip.rotate(left ? g_eagleJoint.leftHip : g_eagleJoint.rightHip, 0, 0, 1);
    eaglePushMatrix(hip);

    let thigh = new Matrix4(hip);
    thigh.scale(0.16, 0.55, 0.16);
    drawEagleCube(thigh, [0.90, 0.73, 0.31]);

    let knee = eaglePopMatrix();
    knee.translate(0.0, -0.53, 0.0);
    knee.rotate(left ? g_eagleJoint.leftKnee : g_eagleJoint.rightKnee, 0, 0, 1);
    eaglePushMatrix(knee);

    let shin = new Matrix4(knee);
    shin.scale(0.13, 0.5, 0.13);
    drawEagleCube(shin, [0.86, 0.67, 0.20]);

    let foot = eaglePopMatrix();
    foot.translate(0.0, -0.5, 0.0);
    foot.scale(0.35, 0.08, 0.22);
    drawEagleCube(foot, [0.97, 0.79, 0.28]);
}

function renderEagle() {
    if (!eagleCubeGeo) {
        return;
    }

    eagleModelStack = [];

    let world = new Matrix4();
    world.translate(EAGLE_WORLD.x, EAGLE_WORLD.y, EAGLE_WORLD.z);
    world.rotate(EAGLE_WORLD.yaw, 0, 1, 0);
    world.scale(EAGLE_WORLD.scale, EAGLE_WORLD.scale, EAGLE_WORLD.scale);

    let eagleRoot = new Matrix4(world);
    eagleRoot.translate(-0.72, -0.66, -0.18);
    eagleRoot.scale(0.42, 0.42, 0.42);

    let body = new Matrix4(eagleRoot);
    body.translate(-1.2, 0.6, -0.4);
    body.scale(2.4, 1.2, 1.4);
    drawEagleCube(body, [0.38, 0.25, 0.13]);

    let chest = new Matrix4(eagleRoot);
    chest.translate(-0.8, 0.35, -0.25);
    chest.scale(1.6, 1.0, 1.1);
    drawEagleCube(chest, [0.55, 0.35, 0.20]);

    let pelvis = new Matrix4(eagleRoot);
    pelvis.translate(-0.7, 0.0, -0.3);
    pelvis.scale(1.4, 0.6, 1.2);
    drawEagleCube(pelvis, [0.30, 0.20, 0.10]);

    let neckBase = new Matrix4(eagleRoot);
    neckBase.translate(-0.25, 1.35, 0.08);
    neckBase.rotate(g_eagleJoint.neck, 0, 0, 1);
    eaglePushMatrix(neckBase);
    neckBase.scale(0.45, 0.7, 0.45);
    drawEagleCube(neckBase, [0.56, 0.42, 0.27]);

    let headRoot = eaglePopMatrix();
    headRoot.translate(0.07, 0.7, 0.1);
    headRoot.rotate(g_eagleJoint.head, 0, 0, 1);
    eaglePushMatrix(headRoot);

    let head = new Matrix4(headRoot);
    head.scale(0.6, 0.5, 0.55);
    drawEagleCube(head, [0.90, 0.90, 0.85]);

    let beakRoot = eaglePopMatrix();
    beakRoot.translate(0.55, 0.22, 0.12);
    beakRoot.rotate(g_eagleJoint.beak, 0, 0, 1);
    let beak = new Matrix4(beakRoot);
    beak.scale(0.5, 0.35, 0.35);
    drawEaglePyramid(beak, [0.95, 0.75, 0.15]);

    let tailRoot = new Matrix4(eagleRoot);
    tailRoot.translate(-1.25, 0.95, 0.1);
    tailRoot.rotate(g_eagleJoint.tail, 0, 0, 1);
    let tail = new Matrix4(tailRoot);
    tail.scale(0.8, 0.25, 0.6);
    drawEagleCube(tail, [0.26, 0.16, 0.08]);

    drawEagleWing(eagleRoot, -0.1, 1.0, -0.35, true);
    drawEagleWing(eagleRoot, -0.1, 1.0, 1.05, false);
    drawEagleLeg(eagleRoot, 0.2, 0.03, -0.1, true);
    drawEagleLeg(eagleRoot, 0.2, 0.03, 0.7, false);
}

function draw() {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    updatePointLightPosition();
    updateEagleAnimation();

    gl.uniform3fv(u_pointLightPos, pointLightPos.elements);
    gl.uniform3fv(u_spotLightPos, spotLightPos.elements);
    gl.uniform3fv(u_spotDirection, spotDirection.elements);
    gl.uniform3f(u_lightColor, lightColor[0], lightColor[1], lightColor[2]);
    gl.uniform1i(u_useLighting, useLighting);
    gl.uniform1i(u_showNormals, showNormals);
    gl.uniform1i(u_pointLightOn, pointLightOn);
    gl.uniform1i(u_spotLightOn, spotLightOn);

    gl.uniform3fv(u_eyePosition, camera.eye.elements);
    gl.uniformMatrix4fv(u_ViewMatrix, false, camera.viewMatrix.elements);
    gl.uniformMatrix4fv(u_ProjMatrix, false, camera.projMatrix.elements);

    for (let m of models) {
        drawModel(m);
    }

    renderEagle();

    requestAnimationFrame(draw);
}

function addModel(color, shapeType) {
    let model = null;
    switch (shapeType) {
        case "cube":
            model = new Cube(color);
            break;
        case "sphere":
            model = new Sphere(color);
            break;
    }

    if (model) {
        models.push(model);
    }
    return model;
}

function buildWorld() {
    let ground = addModel([0.35, 0.35, 0.4], "cube");
    ground.setScale(8.0, 0.1, 8.0);
    ground.setTranslate(0.0, -1.0, 0.0);

    let wallColors = [
        [0.3, 0.5, 0.6],
        [0.4, 0.6, 0.35]
    ];
    let wallPositions = [
        [-4.0, 1.0, 0.0],
        [4.0, 1.0, 0.0]
    ];
    let wallScales = [
        [0.2, 3.0, 8.0],
        [0.2, 3.0, 8.0]
    ];

    for (let i = 0; i < wallColors.length; i++) {
        let wall = addModel(wallColors[i], "cube");
        wall.setScale(wallScales[i][0], wallScales[i][1], wallScales[i][2]);
        wall.setTranslate(wallPositions[i][0], wallPositions[i][1], wallPositions[i][2]);
    }

    let groundTop = -0.9;

    // Yellow arcade ball only
    let heroBall = addModel([1.0, 0.95, 0.4], "sphere");
    heroBall.setScale(1.1, 1.1, 1.1);
    heroBall.setTranslate(0.0, groundTop + 1.1, 0.5);

    initEagle();
}

function onZoomInput(value) {
    camera.zoom(1.0 + value / 10);
}

function onCameraInput(value) {
    let angle = parseFloat(value);
    camera.pan(angle - lastCameraPan);
    lastCameraPan = angle;
}

function onCameraTiltInput(value) {
    let angle = parseFloat(value);
    camera.tilt(angle - lastCameraTilt);
    lastCameraTilt = angle;
}

function onLightInput(value) {
    lightAngleOffset = parseFloat(value);
}

function onLightColorInput() {
    lightColor[0] = document.getElementById("lightRed").value / 100.0;
    lightColor[1] = document.getElementById("lightGreen").value / 100.0;
    lightColor[2] = document.getElementById("lightBlue").value / 100.0;
}

function setPowerButton(btnId, statusId, isOn) {
    let btn = document.getElementById(btnId);
    let status = document.getElementById(statusId);
    if (!btn || !status) {
        return;
    }
    status.textContent = isOn ? "ON" : "OFF";
    status.className = "status " + (isOn ? "on" : "off");
    if (isOn) {
        btn.classList.add("active-power");
    } else {
        btn.classList.remove("active-power");
    }
}

function updateGameHud() {
    setPowerButton("lightingBtn", "lightingStatus", useLighting);
    setPowerButton("normalsBtn", "normalsStatus", showNormals);
    setPowerButton("pointLightBtn", "pointLightStatus", pointLightOn);
    setPowerButton("spotLightBtn", "spotLightStatus", spotLightOn);
}

function toggleLighting() {
    useLighting = !useLighting;
    updateGameHud();
}

function toggleNormals() {
    showNormals = !showNormals;
    updateGameHud();
}

function togglePointLight() {
    pointLightOn = !pointLightOn;
    updateGameHud();
}

function toggleSpotLight() {
    spotLightOn = !spotLightOn;
    updateGameHud();
}

window.addEventListener("keydown", function(event) {
    let speed = 0.3;
    switch (event.key) {
        case "w":
            camera.moveForward(speed);
            break;
        case "s":
            camera.moveForward(-speed);
            break;
        case "a":
            camera.pan(3);
            break;
        case "d":
            camera.pan(-3);
            break;
        case "q":
            camera.tilt(5);
            break;
        case "e":
            camera.tilt(-5);
            break;
    }
});

function main() {
    canvas = document.getElementById("canvas");
    gl = canvas.getContext("webgl");
    if (!gl) {
        console.log("Failed to get webgl context");
        return -1;
    }

    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0.05, 0.05, 0.1, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (!initShaders(gl, VSHADER, FSHADER)) {
        console.log("Failed to initialize shaders.");
        return -1;
    }

    u_ModelMatrix = gl.getUniformLocation(gl.program, "u_ModelMatrix");
    u_ViewMatrix = gl.getUniformLocation(gl.program, "u_ViewMatrix");
    u_ProjMatrix = gl.getUniformLocation(gl.program, "u_ProjMatrix");
    u_NormalMatrix = gl.getUniformLocation(gl.program, "u_NormalMatrix");
    u_Color = gl.getUniformLocation(gl.program, "u_Color");
    u_ambientColor = gl.getUniformLocation(gl.program, "u_ambientColor");
    u_diffuseColor = gl.getUniformLocation(gl.program, "u_diffuseColor");
    u_specularColor = gl.getUniformLocation(gl.program, "u_specularColor");
    u_lightColor = gl.getUniformLocation(gl.program, "u_lightColor");
    u_pointLightPos = gl.getUniformLocation(gl.program, "u_pointLightPos");
    u_spotLightPos = gl.getUniformLocation(gl.program, "u_spotLightPos");
    u_spotDirection = gl.getUniformLocation(gl.program, "u_spotDirection");
    u_spotCosCutoff = gl.getUniformLocation(gl.program, "u_spotCosCutoff");
    u_spotExponent = gl.getUniformLocation(gl.program, "u_spotExponent");
    u_eyePosition = gl.getUniformLocation(gl.program, "u_eyePosition");
    u_useLighting = gl.getUniformLocation(gl.program, "u_useLighting");
    u_showNormals = gl.getUniformLocation(gl.program, "u_showNormals");
    u_pointLightOn = gl.getUniformLocation(gl.program, "u_pointLightOn");
    u_spotLightOn = gl.getUniformLocation(gl.program, "u_spotLightOn");

    buildWorld();

    loadObjModel("models/bunny.obj", [0.98, 0.72, 0.80], function(model) {
        model.setScale(6.0, 6.0, 6.0);
        model.setTranslate(-2.4, -0.12, -2.2);
        model.setRotate(0, 35, 0);
        models.push(model);
        console.log("Loaded bunny.obj — vertices:", model.vertices.length / 3);
    });

    vertexBuffer = initBuffer("a_Position", 3);
    normalBuffer = initBuffer("a_Normal", 3);

    indexBuffer = gl.createBuffer();
    if (!indexBuffer) {
        console.log("Can't create buffer.");
        return -1;
    }

    gl.uniform3f(u_ambientColor, 0.15, 0.15, 0.15);
    gl.uniform3f(u_diffuseColor, 0.8, 0.8, 0.8);
    gl.uniform3f(u_specularColor, 1.0, 1.0, 1.0);
    gl.uniform1f(u_spotCosCutoff, Math.cos(30.0 * Math.PI / 180.0));
    gl.uniform1f(u_spotExponent, 15.0);

    // Start facing the eagle in the back-left corner
    camera = new Camera();
    camera.eye = new Vector3([-1.6, 1.4, -1.8]);
    camera.center = new Vector3([-3.1, 0.35, -3.0]);
    camera.updateView();

    updateGameHud();
    draw();
}
