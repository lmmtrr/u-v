import { Scene } from "@babylonjs/core/scene";
import { Engine } from "@babylonjs/core/Engines/engine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color4 } from "@babylonjs/core/Maths/math.color";
export const createScene = (engine: Engine): Scene => {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.102, 0.102, 0.141, 1.0);
  scene.useRightHandedSystem = true;
  const camera = new ArcRotateCamera(
    "defaultCamera",
    Math.PI / 2,
    Math.PI / 2,
    2.5,
    new Vector3(0, 1, 0),
    scene
  );
  camera.setPosition(new Vector3(0, 1, 1.5));
  camera.setTarget(new Vector3(0, 1, 0));
  const canvas = engine.getRenderingCanvas();
  if (canvas) {
    camera.attachControl(canvas, true);
  }
  camera.lowerBetaLimit = null;
  camera.upperBetaLimit = null;
  enableTrackballRotation(camera);
  camera.wheelPrecision = 500;
  camera.minZ = 0.001;
  camera.maxZ = 10000;
  const defaultLight = new HemisphericLight(
    "defaultLight",
    new Vector3(0, 1, 0),
    scene
  );
  defaultLight.intensity = 0.85;
  const hemiLight = new HemisphericLight(
    "HemiLight",
    new Vector3(0, -2, 0),
    scene
  );
  hemiLight.intensity = 0.6;
  return scene;
};
const enableTrackballRotation = (camera: ArcRotateCamera) => {
  const offset = new Vector3();
  const up = new Vector3();
  const yToUp = new Matrix();
  camera.onAfterCheckInputsObservable.add(() => {
    if (Math.abs(camera.beta - Math.PI / 2) < 1e-6) return;
    const sinb = Math.sin(camera.beta);
    offset.set(
      Math.cos(camera.alpha) * sinb,
      Math.cos(camera.beta),
      Math.sin(camera.alpha) * sinb
    );
    Matrix.RotationAlignToRef(Vector3.UpReadOnly, camera.upVector, yToUp);
    Vector3.TransformNormalToRef(offset, yToUp, offset);
    offset.normalize();
    const dot = Vector3.Dot(camera.upVector, offset);
    camera.upVector.subtractToRef(offset.scale(dot), up);
    if (sinb < 0) up.negateInPlace();
    camera.upVector = up;
    camera.position
      .copyFrom(camera.target)
      .addInPlace(offset.scaleInPlace(camera.radius));
    camera.rebuildAnglesAndRadius();
  });
};
export const setupResizeListener = (engine: Engine) => {
  window.addEventListener("resize", () => {
    engine.resize();
  });
};
