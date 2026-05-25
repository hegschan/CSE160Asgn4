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
let pointLightMarker = null;

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

function draw() {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    updatePointLightPosition();

    gl.uniform3fv(u_pointLightPos, pointLightPos.elements);
    gl.uniform3fv(u_spotLightPos, spotLightPos.elements);
    gl.uniform3fv(u_spotDirection, spotDirection.elements);
    gl.uniform3f(u_lightColor, lightColor[0], lightColor[1], lightColor[2]);
    gl.uniform1i(u_useLighting, useLighting);
    gl.uniform1i(u_showNormals, showNormals);
    gl.uniform1i(u_pointLightOn, pointLightOn);
    gl.uniform1i(u_spotLightOn, spotLightOn);

    pointLightMarker.setTranslate(
        pointLightPos.elements[0],
        pointLightPos.elements[1],
        pointLightPos.elements[2]
    );

    gl.uniform3fv(u_eyePosition, camera.eye.elements);
    gl.uniformMatrix4fv(u_ViewMatrix, false, camera.viewMatrix.elements);
    gl.uniformMatrix4fv(u_ProjMatrix, false, camera.projMatrix.elements);

    for (let m of models) {
        drawModel(m);
    }

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
        [0.6, 0.3, 0.3],
        [0.3, 0.5, 0.6],
        [0.4, 0.6, 0.35],
        [0.5, 0.4, 0.55]
    ];
    let wallPositions = [
        [0.0, 1.0, -4.0],
        [0.0, 1.0, 4.0],
        [-4.0, 1.0, 0.0],
        [4.0, 1.0, 0.0]
    ];
    let wallScales = [
        [8.0, 3.0, 0.2],
        [8.0, 3.0, 0.2],
        [0.2, 3.0, 8.0],
        [0.2, 3.0, 8.0]
    ];

    for (let i = 0; i < 4; i++) {
        let wall = addModel(wallColors[i], "cube");
        wall.setScale(wallScales[i][0], wallScales[i][1], wallScales[i][2]);
        wall.setTranslate(wallPositions[i][0], wallPositions[i][1], wallPositions[i][2]);
    }

    let sphereColors = [
        [0.9, 0.2, 0.2],
        [0.2, 0.8, 0.3],
        [0.2, 0.4, 0.95]
    ];
    for (let i = 0; i < 3; i++) {
        let sphere = addModel(sphereColors[i], "sphere");
        sphere.setScale(0.6, 0.6, 0.6);
        sphere.setTranslate(-2.0 + i * 2.0, 0.0, 0.0);
    }

    let cube = addModel([0.95, 0.85, 0.2], "cube");
    cube.setScale(0.7, 0.7, 0.7);
    cube.setTranslate(0.0, 0.5, -1.5);
}

function onZoomInput(value) {
    camera.zoom(1.0 + value / 10);
}

function onCameraInput(value) {
    let angle = parseFloat(value);
    camera.pan(angle - lastCameraPan);
    lastCameraPan = angle;
}

function onLightInput(value) {
    lightAngleOffset = parseFloat(value);
}

function onLightColorInput() {
    lightColor[0] = document.getElementById("lightRed").value / 100.0;
    lightColor[1] = document.getElementById("lightGreen").value / 100.0;
    lightColor[2] = document.getElementById("lightBlue").value / 100.0;
}

function toggleLighting() {
    useLighting = !useLighting;
    document.getElementById("lightingBtn").textContent =
        "Lighting: " + (useLighting ? "ON" : "OFF");
}

function toggleNormals() {
    showNormals = !showNormals;
    document.getElementById("normalsBtn").textContent =
        "Normals: " + (showNormals ? "ON" : "OFF");
}

function togglePointLight() {
    pointLightOn = !pointLightOn;
    document.getElementById("pointLightBtn").textContent =
        "Point Light: " + (pointLightOn ? "ON" : "OFF");
}

function toggleSpotLight() {
    spotLightOn = !spotLightOn;
    document.getElementById("spotLightBtn").textContent =
        "Spot Light: " + (spotLightOn ? "ON" : "OFF");
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

    loadObjModel("models/cube.obj", [0.8, 0.5, 0.9], function(model) {
        model.setScale(0.8, 0.8, 0.8);
        model.setTranslate(2.5, 0.5, 1.5);
        model.setRotate(0, 25, 0);
        models.push(model);
    });

    pointLightMarker = new Cube([1.0, 1.0, 0.3]);
    pointLightMarker.setScale(0.15, 0.15, 0.15);
    models.push(pointLightMarker);

    let spotMarker = new Cube([0.3, 0.8, 1.0]);
    spotMarker.setScale(0.12, 0.12, 0.12);
    spotMarker.setTranslate(spotLightPos.elements[0], spotLightPos.elements[1], spotLightPos.elements[2]);
    models.push(spotMarker);

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

    camera = new Camera();
    camera.eye = new Vector3([0, 2, 8]);
    camera.center = new Vector3([0, 0, 0]);
    camera.updateView();

    draw();
}
