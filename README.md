# U-V

[https://u-v.pages.dev/](https://u-v.pages.dev/)

An interactive browser-based Unity 3D model viewer.

## Controls & Keyboard Shortcuts

### Keyboard Shortcuts

- **`Z`**: Switch to the **previous** animation clip.
- **`X`**: Switch to the **next** animation clip.
- **`C`**: Toggle the splash screen / upload panel.
- **`V`**: Export the active 3D model alongside its current animation as a **GLB** file.

### 3D Camera Interaction

- **Left-Click + Drag**: Rotate the camera around the 3D model.
- **Right-Click + Drag** (or **Ctrl + Left-Click + Drag**): Pan the camera.
- **Scroll Wheel** (or **Pinch Gesture**): Zoom in / zoom out.

## Building and Running

### 1. Compile the WebAssembly Module

```bash
wasm-pack build --target web
```

### 2. Install Dependencies and Bundle the Frontend

#### Install node packages

```bash
bun install
```

#### Watch files and auto-compile during development

```bash
bun run dev
```

#### Compile and minify for production

```bash
bun run build
```

### 3. Run a Local HTTP Server

#### Start a local HTTP server (for instance, using Python):

```bash
python -m http.server 8000
```

#### Open your web browser and navigate to:

```
http://localhost:8000/
```

## License

[MIT License](https://github.com/lmmtrr/unityfs/blob/main/LICENSE)
