use js_sys::{Float32Array, Uint32Array, Uint8Array};
use serde::Serialize;
use std::collections::HashMap;
use unrealfs::animation::SampledAnimation;
use unrealfs::skeletal_mesh::{Bone, MaterialSlot, Section, Socket};
use unrealfs::texture::DecodedTexture;
use wasm_bindgen::prelude::*;

pub use unrealfs::is_unreal_file;

#[derive(Serialize)]
struct AnimMeta<'a> {
    name: &'a str,
    num_frames: u32,
    length: f32,
    bones: &'a [String],
    channels: &'a [[bool; 3]],
    curves: &'a [String],
}

#[derive(Serialize)]
struct MeshInfo<'a> {
    name: &'a str,
    path: &'a str,
    version: &'a str,
    skeleton: &'a Option<String>,
    sockets: &'a [Socket],
    physics_bones: &'a [String],
    bones: &'a [Bone],
    materials: &'a [MaterialSlot],
    sections: &'a [Section],
    vertex_count: usize,
    morphs: Vec<(&'a str, usize)>,
}

#[wasm_bindgen]
#[derive(Default)]
pub struct UeEnvironment {
    inner: unrealfs::UeEnvironment,
    textures: HashMap<String, DecodedTexture>,
    animations: HashMap<String, SampledAnimation>,
}

#[wasm_bindgen]
impl UeEnvironment {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    #[wasm_bindgen(js_name = isUnrealFile)]
    pub fn is_unreal_file_js(path: &str) -> bool {
        is_unreal_file(path)
    }

    #[wasm_bindgen(js_name = addFile)]
    pub fn add_file(&mut self, path: &str, data: Vec<u8>) -> bool {
        self.inner.add_file(path, data)
    }

    #[wasm_bindgen(js_name = getMeshes)]
    pub fn get_meshes(&mut self) -> String {
        serde_json::to_string(&self.inner.meshes()).unwrap_or_else(|_| "[]".into())
    }

    #[wasm_bindgen(js_name = getAllSockets)]
    pub fn get_all_sockets(&mut self) -> String {
        serde_json::to_string(&self.inner.sockets()).unwrap_or_else(|_| "[]".into())
    }

    #[wasm_bindgen(js_name = getMaterial)]
    pub fn get_material(&mut self, game_path: &str) -> String {
        serde_json::to_string(&self.inner.material_info(game_path)).unwrap_or_else(|_| "null".into())
    }

    #[wasm_bindgen(js_name = decodeTexture)]
    pub fn decode_texture(&mut self, game_path: &str) -> Result<String, JsValue> {
        let tex = self.inner.texture(game_path).map_err(|e| JsValue::from_str(&e))?;
        let meta = serde_json::json!({ "width": tex.width, "height": tex.height, "format": tex.format });
        self.textures.insert(game_path.to_string(), tex);
        Ok(meta.to_string())
    }

    #[wasm_bindgen(js_name = takeTexturePixels)]
    pub fn take_texture_pixels(&mut self, game_path: &str) -> Option<Uint8Array> {
        self.textures.remove(game_path).map(|t| Uint8Array::from(t.rgba.as_slice()))
    }

    #[wasm_bindgen(js_name = getAnimations)]
    pub fn get_animations(&mut self) -> String {
        serde_json::to_string(&self.inner.animation_list()).unwrap_or_else(|_| "[]".into())
    }

    #[wasm_bindgen(js_name = loadAnimation)]
    pub fn load_animation(&mut self, path: &str) -> Result<String, JsValue> {
        let anim = self.inner.sample_animation(path).map_err(|e| JsValue::from_str(&e))?;
        let meta = AnimMeta {
            name: &anim.info.name,
            num_frames: anim.info.num_frames,
            length: anim.info.length,
            bones: &anim.bones,
            channels: &anim.channels,
            curves: &anim.curves,
        };
        let json = serde_json::to_string(&meta).map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.animations.insert(path.to_string(), anim);
        Ok(json)
    }

    #[wasm_bindgen(js_name = takeAnimationSamples)]
    pub fn take_animation_samples(&mut self, path: &str) -> Option<Float32Array> {
        self.animations.remove(path).map(|a| {
            let mut all = a.samples;
            all.extend_from_slice(&a.curve_samples);
            Float32Array::from(all.as_slice())
        })
    }

    #[wasm_bindgen(js_name = needsMappings)]
    pub fn needs_mappings(&mut self) -> bool {
        self.inner.needs_mappings()
    }

    #[wasm_bindgen(js_name = getErrors)]
    pub fn get_errors(&self) -> String {
        serde_json::to_string(self.inner.errors()).unwrap_or_else(|_| "[]".into())
    }

    #[wasm_bindgen(js_name = loadMesh)]
    pub fn load_mesh(&mut self, path: &str) -> Result<String, JsValue> {
        let mesh = self.inner.load_mesh(path).map_err(|e| JsValue::from_str(&e))?;
        let info = MeshInfo {
            name: &mesh.name,
            path,
            version: &mesh.version,
            skeleton: &mesh.skeleton,
            sockets: &mesh.sockets,
            physics_bones: &mesh.physics_bones,
            bones: &mesh.bones,
            materials: &mesh.materials,
            sections: &mesh.sections,
            vertex_count: mesh.positions.len() / 3,
            morphs: mesh.morphs.iter().map(|m| (m.name.as_str(), m.vertices.len())).collect(),
        };
        serde_json::to_string(&info).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen(js_name = getPositions)]
    pub fn get_positions(&self, path: &str) -> Option<Float32Array> {
        self.inner.mesh(path).map(|m| Float32Array::from(m.positions.as_slice()))
    }

    #[wasm_bindgen(js_name = getNormals)]
    pub fn get_normals(&self, path: &str) -> Option<Float32Array> {
        self.inner.mesh(path).map(|m| Float32Array::from(m.normals.as_slice()))
    }

    #[wasm_bindgen(js_name = getUVs)]
    pub fn get_uvs(&self, path: &str) -> Option<Float32Array> {
        self.inner.mesh(path).map(|m| Float32Array::from(m.uvs.as_slice()))
    }

    #[wasm_bindgen(js_name = getIndices)]
    pub fn get_indices(&self, path: &str) -> Option<Uint32Array> {
        self.inner.mesh(path).map(|m| Uint32Array::from(m.indices.as_slice()))
    }

    #[wasm_bindgen(js_name = getSkinIndices)]
    pub fn get_skin_indices(&self, path: &str) -> Option<Uint32Array> {
        self.inner.mesh(path).map(|m| Uint32Array::from(m.skin_indices.as_slice()))
    }

    #[wasm_bindgen(js_name = getMorphData)]
    pub fn get_morph_data(&self, path: &str) -> Option<Float32Array> {
        let mesh = self.inner.mesh(path)?;
        let mut out = Vec::new();
        for m in &mesh.morphs {
            for (i, &v) in m.vertices.iter().enumerate() {
                out.push(v as f32);
                out.extend_from_slice(&m.position_deltas[i * 3..i * 3 + 3]);
                out.extend_from_slice(&m.normal_deltas[i * 3..i * 3 + 3]);
            }
        }
        Some(Float32Array::from(out.as_slice()))
    }

    #[wasm_bindgen(js_name = getSkinWeights)]
    pub fn get_skin_weights(&self, path: &str) -> Option<Float32Array> {
        self.inner.mesh(path).map(|m| Float32Array::from(m.skin_weights.as_slice()))
    }
}
