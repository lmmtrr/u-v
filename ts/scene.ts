import { Scene } from "@babylonjs/core/scene";
import { Engine } from "@babylonjs/core/Engines/engine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
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
export const setupResizeListener = (engine: Engine) => {
  window.addEventListener("resize", () => {
    engine.resize();
  });
};
