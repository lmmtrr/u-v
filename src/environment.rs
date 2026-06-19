use wasm_bindgen::prelude::*;
use js_sys::{Float32Array, Uint32Array, Uint8Array};
use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use unityfs::{Bundle, Reader, SerializedFile, UnityValue, UnityVersion};
use unityfs::assets::AssetManager;
use unityfs::classes::{texture2d::Texture2D, mesh::Mesh};
use unityfs::classes::TryFromUnityValue;
#[derive(Serialize)]
pub enum ClassType {
    GameObject(serde_json::Value),
    Transform(serde_json::Value),
    Material(serde_json::Value),
    Mesh(serde_json::Value),
    MeshFilter(serde_json::Value),
    MeshRenderer(serde_json::Value),
    SkinnedMeshRenderer(serde_json::Value),
    Texture2D(serde_json::Value),
    TextAsset(serde_json::Value),
    AnimationClip(serde_json::Value),
    Animator(serde_json::Value),
    Avatar(serde_json::Value),
    SpringBone(serde_json::Value),
    DynamicBone(serde_json::Value),
    AssetBundle(serde_json::Value),
    Unknown {
        path_id: i64,
        class_id: i32,
    },
}
fn simplify_name_rust(name: &str) -> String {
    let name = name.replace('\\', "/");
    let basename = name.rsplit('/').next().unwrap_or(&name);
    basename.to_lowercase()
}
#[wasm_bindgen]
pub struct Environment {
    pub(crate) objects: Vec<ClassType>,
    pub(crate) object_hash: HashMap<String, String>,
    pub(crate) asset_manager: unityfs::assets::AssetManager,
}
pub(crate) fn decompress_texture(width: usize, height: usize, format: i32, image_data: &[u8]) -> Option<Vec<u8>> {
    let (block_w, block_h) = match format {
        10 | 11 | 12 | 24 | 25 | 26 | 27 | 34 | 35 | 36 | 41 | 42 | 43 | 44 | 45 | 46 | 47 => (4, 4),
        30 | 31 => (8, 4),
        32 | 33 => (4, 4),
        48 | 54 | 66 => (4, 4),
        49 | 55 | 67 => (5, 5),
        50 | 56 | 68 => (6, 6),
        51 | 57 | 69 => (8, 8),
        52 | 58 | 70 => (10, 10),
        53 | 59 | 71 => (12, 12),
        _ => (1, 1),
    };
    let aligned_w = ((width + block_w - 1) / block_w) * block_w;
    let aligned_h = ((height + block_h - 1) / block_h) * block_h;
    let aligned_size = aligned_w * aligned_h;
    let is_crunch = matches!(format, 28 | 29 | 64 | 65);
    let buffer_size = if is_crunch {
        width * height * 2
    } else {
        std::cmp::max(width * height, aligned_size)
    };
    let mut decompressed = vec![0u32; buffer_size];
    let mut success = false;
    let expected_input_size = match format {
        10 | 34 | 45 | 46 | 60 | 61 => {
            Some(((width + 3) / 4) * ((height + 3) / 4) * 8)
        }
        12 | 25 | 27 | 47 => {
            Some(((width + 3) / 4) * ((height + 3) / 4) * 16)
        }
        26 => {
            Some(((width + 3) / 4) * ((height + 3) / 4) * 8)
        }
        48 | 54 | 66 => {
            Some(((width + 3) / 4) * ((height + 3) / 4) * 16)
        }
        49 | 55 | 67 => {
            Some(((width + 4) / 5) * ((height + 4) / 5) * 16)
        }
        50 | 56 | 68 => {
            Some(((width + 5) / 6) * ((height + 5) / 6) * 16)
        }
        51 | 57 | 69 => {
            Some(((width + 7) / 8) * ((height + 7) / 8) * 16)
        }
        52 | 58 | 70 => {
            Some(((width + 9) / 10) * ((height + 9) / 10) * 16)
        }
        53 | 59 | 71 => {
            Some(((width + 11) / 12) * ((height + 11) / 12) * 16)
        }
        _ => None,
    };
    let safe_image_data = match expected_input_size {
        Some(size) if image_data.len() >= size => &image_data[0..size],
        _ => image_data,
    };
    match format {
        28 | 29 | 64 | 65 => {
            success = texture2ddecoder::decode_unity_crunch(image_data, width, height, &mut decompressed).is_ok();
        }
        1 => {
            for (i, &a) in safe_image_data.iter().enumerate().take(width * height) {
                decompressed[i] = ((a as u32) << 24) | 0x00FFFFFF;
            }
            success = true;
        }
        2 => {
            for (i, chunk) in safe_image_data.chunks_exact(2).enumerate().take(width * height) {
                let val = u16::from_le_bytes([chunk[0], chunk[1]]);
                let a = ((val >> 12) & 0xF) as u8 * 17;
                let r = ((val >> 8) & 0xF) as u8 * 17;
                let g = ((val >> 4) & 0xF) as u8 * 17;
                let b = (val & 0xF) as u8 * 17;
                decompressed[i] = u32::from_le_bytes([b, g, r, a]);
            }
            success = true;
        }
        3 => {
            for (i, chunk) in safe_image_data.chunks_exact(3).enumerate().take(width * height) {
                decompressed[i] = u32::from_le_bytes([chunk[2], chunk[1], chunk[0], 255]);
            }
            success = true;
        }
        4 => {
            for (i, chunk) in safe_image_data.chunks_exact(4).enumerate().take(width * height) {
                decompressed[i] = u32::from_le_bytes([chunk[2], chunk[1], chunk[0], chunk[3]]);
            }
            success = true;
        }
        5 => {
            for (i, chunk) in safe_image_data.chunks_exact(4).enumerate().take(width * height) {
                decompressed[i] = u32::from_le_bytes([chunk[3], chunk[2], chunk[1], chunk[0]]);
            }
            success = true;
        }
        7 => {
            for (i, chunk) in safe_image_data.chunks_exact(2).enumerate().take(width * height) {
                let val = u16::from_le_bytes([chunk[0], chunk[1]]);
                let r = ((val >> 11) & 0x1F) as u8;
                let g = ((val >> 5) & 0x3F) as u8;
                let b = (val & 0x1F) as u8;
                let r8 = (r << 3) | (r >> 2);
                let g8 = (g << 2) | (g >> 4);
                let b8 = (b << 3) | (b >> 2);
                decompressed[i] = u32::from_le_bytes([b8, g8, r8, 255]);
            }
            success = true;
        }
        8 => {
            for (i, chunk) in safe_image_data.chunks_exact(3).enumerate().take(width * height) {
                decompressed[i] = u32::from_le_bytes([chunk[0], chunk[1], chunk[2], 255]);
            }
            success = true;
        }
        10 => {
            success = texture2ddecoder::decode_bc1(safe_image_data, aligned_w, aligned_h, &mut decompressed).is_ok();
        }
        11 => {
            let bw = (width + 3) / 4;
            let bh = (height + 3) / 4;
            if safe_image_data.len() >= bw * bh * 16 {
                for by in 0..bh {
                    for bx in 0..bw {
                        let offset = (by * bw + bx) * 16;
                        let alpha = &safe_image_data[offset..offset + 8];
                        let color = &safe_image_data[offset + 8..offset + 16];
                        let mut block = [0u32; 16];
                        if texture2ddecoder::decode_bc1(color, 4, 4, &mut block).is_ok() {
                            for i in 0..16 {
                                let px = bx * 4 + (i % 4);
                                let py = by * 4 + (i / 4);
                                if px < width && py < height {
                                    let a = (alpha[i / 2] >> ((i % 2) * 4)) & 0xF;
                                    let a8 = a | (a << 4);
                                    let c = block[i].to_le_bytes();
                                    decompressed[py * width + px] = u32::from_le_bytes([c[0], c[1], c[2], a8]);
                                }
                            }
                        }
                    }
                }
                success = true;
            }
        }
        12 => {
            success = texture2ddecoder::decode_bc3(safe_image_data, aligned_w, aligned_h, &mut decompressed).is_ok();
        }
        14 => {
            for (i, chunk) in safe_image_data.chunks_exact(4).enumerate().take(width * height) {
                decompressed[i] = u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
            }
            success = true;
        }
        24 => {
            success = texture2ddecoder::decode_bc6(safe_image_data, aligned_w, aligned_h, &mut decompressed, false).is_ok();
        }
        25 => {
            success = texture2ddecoder::decode_bc7(safe_image_data, aligned_w, aligned_h, &mut decompressed).is_ok();
        }
        26 => {
            success = texture2ddecoder::decode_bc4(safe_image_data, aligned_w, aligned_h, &mut decompressed).is_ok();
        }
        27 => {
            success = texture2ddecoder::decode_bc5(safe_image_data, aligned_w, aligned_h, &mut decompressed).is_ok();
        }
        30 | 31 => {
            success = texture2ddecoder::decode_pvrtc_2bpp(safe_image_data, aligned_w, aligned_h, &mut decompressed).is_ok();
        }
        32 | 33 => {
            success = texture2ddecoder::decode_pvrtc_4bpp(safe_image_data, aligned_w, aligned_h, &mut decompressed).is_ok();
        }
        34 | 60 | 61 => {
            success = texture2ddecoder::decode_etc1(safe_image_data, aligned_w, aligned_h, &mut decompressed).is_ok();
        }
        35 => {
            success = texture2ddecoder::decode_atc_rgb4(safe_image_data, aligned_w, aligned_h, &mut decompressed).is_ok();
        }
        36 => {
            success = texture2ddecoder::decode_atc_rgba8(safe_image_data, aligned_w, aligned_h, &mut decompressed).is_ok();
        }
        41 => {
            success = texture2ddecoder::decode_eacr(safe_image_data, aligned_w, aligned_h, &mut decompressed).is_ok();
        }
        42 => {
            success = texture2ddecoder::decode_eacr_signed(safe_image_data, aligned_w, aligned_h, &mut decompressed).is_ok();
        }
        43 => {
            success = texture2ddecoder::decode_eacrg(safe_image_data, aligned_w, aligned_h, &mut decompressed).is_ok();
        }
        44 => {
            success = texture2ddecoder::decode_eacrg_signed(safe_image_data, aligned_w, aligned_h, &mut decompressed).is_ok();
        }
        45 => {
            success = texture2ddecoder::decode_etc2_rgb(safe_image_data, aligned_w, aligned_h, &mut decompressed).is_ok();
        }
        46 => {
            success = texture2ddecoder::decode_etc2_rgba1(safe_image_data, aligned_w, aligned_h, &mut decompressed).is_ok();
        }
        47 => {
            success = texture2ddecoder::decode_etc2_rgba8(safe_image_data, aligned_w, aligned_h, &mut decompressed).is_ok();
        }
        48 | 54 | 66 => {
            success = texture2ddecoder::decode_astc(safe_image_data, aligned_w, aligned_h, 4, 4, &mut decompressed).is_ok();
        }
        49 | 55 | 67 => {
            success = texture2ddecoder::decode_astc(safe_image_data, aligned_w, aligned_h, 5, 5, &mut decompressed).is_ok();
        }
        50 | 56 | 68 => {
            success = texture2ddecoder::decode_astc(safe_image_data, aligned_w, aligned_h, 6, 6, &mut decompressed).is_ok();
        }
        51 | 57 | 69 => {
            success = texture2ddecoder::decode_astc(safe_image_data, aligned_w, aligned_h, 8, 8, &mut decompressed).is_ok();
        }
        52 | 58 | 70 => {
            success = texture2ddecoder::decode_astc(safe_image_data, aligned_w, aligned_h, 10, 10, &mut decompressed).is_ok();
        }
        53 | 59 | 71 => {
            success = texture2ddecoder::decode_astc(safe_image_data, aligned_w, aligned_h, 12, 12, &mut decompressed).is_ok();
        }
        _ => {
            if safe_image_data.len() == width * height * 4 {
                for (i, chunk) in safe_image_data.chunks_exact(4).enumerate() {
                    decompressed[i] = u32::from_le_bytes([chunk[2], chunk[1], chunk[0], chunk[3]]);
                }
                success = true;
            }
        }
    }
    if success {
        let mut bytes = Vec::with_capacity(width * height * 4);
        let mut has_strong_alpha = false;
        let mut non_zero_count = 0;
        for y in 0..height {
            for x in 0..width {
                let idx = y * aligned_w + x;
                let p = decompressed[idx];
                let b = p.to_le_bytes();
                bytes.push(b[2]);
                bytes.push(b[1]);
                bytes.push(b[0]);
                bytes.push(b[3]);
                if b[3] > 50 {
                    has_strong_alpha = true;
                }
                if b[3] > 15 {
                    non_zero_count += 1;
                }
            }
        }
        let total_pixels = width * height;
        let threshold = total_pixels / 200;
        if !has_strong_alpha || non_zero_count < threshold {
            for chunk in bytes.chunks_exact_mut(4) {
                chunk[3] = 255;
            }
        }
        Some(bytes)
    } else {
        None
    }
}
pub fn unity_value_to_json(value: &UnityValue) -> serde_json::Value {
    match value {
        UnityValue::Boolean(b) => serde_json::Value::Bool(*b),
        UnityValue::Int8(i) => serde_json::Value::Number(serde_json::Number::from(*i)),
        UnityValue::UInt8(u) => serde_json::Value::Number(serde_json::Number::from(*u)),
        UnityValue::Int16(i) => serde_json::Value::Number(serde_json::Number::from(*i)),
        UnityValue::UInt16(u) => serde_json::Value::Number(serde_json::Number::from(*u)),
        UnityValue::Int32(i) => serde_json::Value::Number(serde_json::Number::from(*i)),
        UnityValue::UInt32(u) => serde_json::Value::Number(serde_json::Number::from(*u)),
        UnityValue::Int64(i) => serde_json::Value::Number(serde_json::Number::from(*i)),
        UnityValue::UInt64(u) => serde_json::Value::Number(serde_json::Number::from(*u)),
        UnityValue::Float(f) => serde_json::Value::Number(serde_json::Number::from_f64(*f as f64).unwrap_or(serde_json::Number::from(0))),
        UnityValue::Double(d) => serde_json::Value::Number(serde_json::Number::from_f64(*d).unwrap_or(serde_json::Number::from(0))),
        UnityValue::String(s) => serde_json::Value::String(s.clone()),
        UnityValue::Bytes(b) => {
            let arr = b.iter().map(|&x| serde_json::Value::Number(serde_json::Number::from(x))).collect();
            serde_json::Value::Array(arr)
        }
        UnityValue::Array(arr) => {
            let json_arr = arr.iter().map(unity_value_to_json).collect();
            serde_json::Value::Array(json_arr)
        }
        UnityValue::Map(map) => {
            let mut json_map = serde_json::Map::new();
            for (k, v) in map {
                let key = if k == "m_Name" { "name".to_string() } else { k.clone() };
                json_map.insert(key, unity_value_to_json(v));
            }
            serde_json::Value::Object(json_map)
        }
        UnityValue::PPtr { file_id, path_id } => {
            let mut json_map = serde_json::Map::new();
            json_map.insert("file_id".to_string(), serde_json::Value::Number(serde_json::Number::from(*file_id)));
            json_map.insert("path_id".to_string(), serde_json::Value::String(path_id.to_string()));
            json_map.insert("m_FileID".to_string(), serde_json::Value::Number(serde_json::Number::from(*file_id)));
            json_map.insert("m_PathID".to_string(), serde_json::Value::String(path_id.to_string()));
            serde_json::Value::Object(json_map)
        }
        UnityValue::Null => serde_json::Value::Null,
    }
}
fn process_mesh(mesh: &Mesh, path_id: i64) -> serde_json::Value {
    let mut json_map = serde_json::Map::new();
    json_map.insert("path_id".to_string(), serde_json::Value::String(path_id.to_string()));
    json_map.insert("name".to_string(), serde_json::Value::String(mesh.m_Name.clone()));
    json_map.insert("m_VertexCount".to_string(), serde_json::Value::Number(mesh.m_VertexData.m_VertexCount.into()));
    json_map.insert("m_Vertices".to_string(), serde_json::Value::Array(Vec::new()));
    json_map.insert("m_Normals".to_string(), serde_json::Value::Array(Vec::new()));
    json_map.insert("m_UV0".to_string(), serde_json::Value::Array(Vec::new()));
    json_map.insert("m_Indices".to_string(), serde_json::Value::Array(Vec::new()));
    json_map.insert("m_Skin".to_string(), serde_json::Value::Array(Vec::new()));
    let submeshes = mesh.m_SubMeshes.iter().map(|sub| {
        let mut sub_map = serde_json::Map::new();
        sub_map.insert("firstByte".to_string(), serde_json::Value::Number(sub.firstByte.into()));
        sub_map.insert("indexCount".to_string(), serde_json::Value::Number(sub.indexCount.into()));
        sub_map.insert("topology".to_string(), serde_json::Value::Number(sub.topology.into()));
        sub_map.insert("baseVertex".to_string(), serde_json::Value::Number(sub.baseVertex.into()));
        sub_map.insert("firstVertex".to_string(), serde_json::Value::Number(sub.firstVertex.into()));
        sub_map.insert("vertexCount".to_string(), serde_json::Value::Number(sub.vertexCount.into()));
        serde_json::Value::Object(sub_map)
    }).collect();
    json_map.insert("m_SubMeshes".to_string(), serde_json::Value::Array(submeshes));
    if let Some(ref poses) = mesh.m_BindPose {
        let pose_values = poses.iter().map(|pose| {
            let float_values = pose.e.iter().map(|&val| serde_json::Value::Number(serde_json::Number::from_f64(val as f64).unwrap_or(serde_json::Number::from(0)))).collect();
            serde_json::Value::Array(float_values)
        }).collect();
        json_map.insert("m_BindPose".to_string(), serde_json::Value::Array(pose_values));
    }
    if let Some(ref hashes) = mesh.m_BoneNameHashes {
        let hash_values = hashes.iter().map(|&h| serde_json::Value::Number(h.into())).collect();
        json_map.insert("m_BoneNameHashes".to_string(), serde_json::Value::Array(hash_values));
    }
    serde_json::Value::Object(json_map)
}
fn process_skinned_mesh_renderer(val: &UnityValue, path_id: i64) -> serde_json::Value {
    let mut json = unity_value_to_json(val);
    if let serde_json::Value::Object(ref mut map) = json {
        map.insert("path_id".to_string(), serde_json::Value::String(path_id.to_string()));
        if let Some(mesh_ptr) = val.get("m_Mesh") {
            if let UnityValue::PPtr { path_id: m_path_id, .. } = mesh_ptr {
                map.insert("mesh_path_id".to_string(), serde_json::Value::String(m_path_id.to_string()));
            }
        }
        if let Some(bones_val) = val.get("m_Bones") {
            if let UnityValue::Array(bones_arr) = bones_val {
                let bone_ids: Vec<serde_json::Value> = bones_arr.iter().filter_map(|b| {
                    if let UnityValue::PPtr { path_id: b_path_id, .. } = b {
                        Some(serde_json::Value::String(b_path_id.to_string()))
                    } else {
                        None
                    }
                }).collect();
                map.insert("bone_path_ids".to_string(), serde_json::Value::Array(bone_ids));
            }
        }
    }
    json
}
fn collect_pptr_path_ids(value: &UnityValue, path_ids: &mut std::collections::HashSet<i64>) {
    match value {
        UnityValue::PPtr { path_id, .. } => {
            if *path_id != 0 {
                path_ids.insert(*path_id);
            }
        }
        UnityValue::Array(arr) => {
            for v in arr {
                collect_pptr_path_ids(v, path_ids);
            }
        }
        UnityValue::Map(map) => {
            for v in map.values() {
                collect_pptr_path_ids(v, path_ids);
            }
        }
        _ => {}
    }
}
fn process_texture2d(val: &UnityValue, path_id: i64, _asset_manager: &AssetManager, _referenced_textures: &std::collections::HashSet<i64>) -> serde_json::Value {
    let mut json = unity_value_to_json(val);
    if let serde_json::Value::Object(ref mut map) = json {
        map.insert("path_id".to_string(), serde_json::Value::String(path_id.to_string()));
        map.remove("image_data");
    }
    json
}
pub fn preprocess_avatar_json(json: &mut serde_json::Value) {
    let m_avatar = match json.get("m_Avatar") {
        Some(v) => v,
        None => return,
    };
    let skeleton_data = match m_avatar.get("m_AvatarSkeleton").and_then(|v| v.get("data")) {
        Some(v) => v,
        None => return,
    };
    let m_id = match skeleton_data.get("m_ID").and_then(|v| v.as_array()) {
        Some(v) => v,
        None => return,
    };
    let human_data = match m_avatar.get("m_Human").and_then(|v| v.get("data")) {
        Some(v) => v,
        None => return,
    };
    let m_human_bone_index = match human_data.get("m_HumanBoneIndex").and_then(|v| v.as_array()) {
        Some(v) => v,
        None => return,
    };
    let hsia = match m_avatar.get("m_HumanSkeletonIndexArray").and_then(|v| v.as_array()) {
        Some(v) => v,
        None => return,
    };
    let left_hand_bone_index = human_data.get("m_LeftHand")
        .and_then(|v| v.get("data"))
        .and_then(|v| v.get("m_HandBoneIndex"))
        .and_then(|v| v.as_array());
    let right_hand_bone_index = human_data.get("m_RightHand")
        .and_then(|v| v.get("data"))
        .and_then(|v| v.get("m_HandBoneIndex"))
        .and_then(|v| v.as_array());
    let axes_array = human_data.get("m_Skeleton")
        .and_then(|v| v.get("data"))
        .and_then(|v| v.get("m_AxesArray"))
        .and_then(|v| v.as_array());
    let human_skeleton_nodes = human_data.get("m_Skeleton")
        .and_then(|v| v.get("data"))
        .and_then(|v| v.get("m_Node"))
        .and_then(|v| v.as_array());
    let tos = match json.get("m_TOS").and_then(|v| v.as_array()) {
        Some(v) => v,
        None => return,
    };
    let mut tos_map = HashMap::new();
    for entry in tos {
        if let Some(arr) = entry.as_array() {
            if arr.len() == 2 {
                let key = match &arr[0] {
                    serde_json::Value::Number(n) => n.as_u64().unwrap_or(0).to_string(),
                    serde_json::Value::String(s) => s.clone(),
                    _ => continue,
                };
                let val = arr[1].as_str().unwrap_or("").to_string();
                tos_map.insert(key, val);
            }
        } else if let Some(obj) = entry.as_object() {
            let key = obj.get("first").or(obj.get("m_First"))
                .and_then(|v| match v {
                    serde_json::Value::Number(n) => Some(n.as_u64().unwrap_or(0).to_string()),
                    serde_json::Value::String(s) => Some(s.clone()),
                    _ => None,
                });
            let val = obj.get("second").or(obj.get("m_Second"))
                .and_then(|v| v.as_str())
                .unwrap_or("").to_string();
            if let Some(k) = key {
                tos_map.insert(k, val);
            }
        }
    }
    let mut humanoid_bones = serde_json::Map::new();
    let resolve_bone = |rig_node_idx: i64| -> Option<serde_json::Value> {
        if rig_node_idx < 0 { return None; }
        let skeleton_node_idx = if rig_node_idx < hsia.len() as i64 {
            hsia[rig_node_idx as usize].as_i64().unwrap_or(-1)
        } else {
            rig_node_idx
        };
        if skeleton_node_idx < 0 || skeleton_node_idx >= m_id.len() as i64 {
            return None;
        }
        let hash_str = m_id[skeleton_node_idx as usize].as_u64().unwrap_or(0).to_string();
        let path = tos_map.get(&hash_str)?.clone();
        let mut pre_q = serde_json::json!({ "w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0 });
        let mut post_q = serde_json::json!({ "w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0 });
        let mut limit_min = serde_json::json!({ "x": 0.0, "y": 0.0, "z": 0.0 });
        let mut limit_max = serde_json::json!({ "x": 0.0, "y": 0.0, "z": 0.0 });
        if let (Some(nodes), Some(axes)) = (human_skeleton_nodes, axes_array) {
            if rig_node_idx < nodes.len() as i64 {
                if let Some(axes_id_val) = nodes[rig_node_idx as usize].get("m_AxesId") {
                    let axes_id = axes_id_val.as_i64().unwrap_or(-1);
                    if axes_id >= 0 && axes_id < axes.len() as i64 {
                        let axis_data = &axes[axes_id as usize];
                        if let Some(pq) = axis_data.get("m_PreQ") { pre_q = pq.clone(); }
                        if let Some(poq) = axis_data.get("m_PostQ") { post_q = poq.clone(); }
                        if let Some(limit) = axis_data.get("m_Limit") {
                            if let Some(min) = limit.get("m_Min") { limit_min = min.clone(); }
                            if let Some(max) = limit.get("m_Max") { limit_max = max.clone(); }
                        }
                    }
                }
            }
        }
        Some(serde_json::json!({
            "bone_path": path,
            "preQ": pre_q,
            "postQ": post_q,
            "limitMin": limit_min,
            "limitMax": limit_max
        }))
    };
    for (i, val) in m_human_bone_index.iter().enumerate() {
        let rig_node_idx = val.as_i64().unwrap_or(-1);
        let standard_bone_idx = match i {
            0 => 0,  
            1 => 1,  
            2 => 2,  
            3 => 3,  
            4 => 4,  
            5 => 5,  
            6 => 6,  
            7 => 7,  
            8 => 8,  
            9 => 54, 
            10 => 9,  
            11 => 10, 
            12 => 11, 
            13 => 12, 
            14 => 13, 
            15 => 14, 
            16 => 15, 
            17 => 16, 
            18 => 17, 
            19 => 18, 
            20 => 19, 
            21 => 20, 
            22 => 21, 
            23 => 22, 
            24 => 23, 
            _ => continue,
        };
        if let Some(bone_info) = resolve_bone(rig_node_idx) {
            humanoid_bones.insert(standard_bone_idx.to_string(), bone_info);
        }
    }
    if let Some(left_hand_arr) = left_hand_bone_index {
        for (i, val) in left_hand_arr.iter().enumerate() {
            let rig_node_idx = val.as_i64().unwrap_or(-1);
            let standard_bone_idx = 24 + i;
            if let Some(bone_info) = resolve_bone(rig_node_idx) {
                humanoid_bones.insert(standard_bone_idx.to_string(), bone_info);
            }
        }
    }
    if let Some(right_hand_arr) = right_hand_bone_index {
        for (i, val) in right_hand_arr.iter().enumerate() {
            let rig_node_idx = val.as_i64().unwrap_or(-1);
            let standard_bone_idx = 39 + i;
            if let Some(bone_info) = resolve_bone(rig_node_idx) {
                humanoid_bones.insert(standard_bone_idx.to_string(), bone_info);
            }
        }
    }
    if let serde_json::Value::Object(map) = json {
        map.insert("humanoidBones".to_string(), serde_json::Value::Object(humanoid_bones));
    }
}
#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
pub struct WasmQuaternion {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub w: f32,
}
#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
pub struct WasmVector3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}
#[derive(Debug, Clone, Copy)]
pub struct SimpleQuat {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub w: f32,
}
impl SimpleQuat {
    pub fn identity() -> Self {
        SimpleQuat { x: 0.0, y: 0.0, z: 0.0, w: 1.0 }
    }
    pub fn from_axis_angle(axis_x: f32, axis_y: f32, axis_z: f32, angle: f32) -> Self {
        let half_angle = angle * 0.5;
        let s = half_angle.sin();
        let c = half_angle.cos();
        SimpleQuat {
            x: axis_x * s,
            y: axis_y * s,
            z: axis_z * s,
            w: c,
        }
    }
    pub fn multiply(&self, other: &Self) -> Self {
        SimpleQuat {
            x: self.w * other.x + self.x * other.w + self.y * other.z - self.z * other.y,
            y: self.w * other.y - self.x * other.z + self.y * other.w + self.z * other.x,
            z: self.w * other.z + self.x * other.y - self.y * other.x + self.z * other.w,
            w: self.w * other.w - self.x * other.x - self.y * other.y - self.z * other.z,
        }
    }
    pub fn inverse(&self) -> Self {
        let norm_sq = self.x * self.x + self.y * self.y + self.z * self.z + self.w * self.w;
        if norm_sq > 0.0 {
            let inv_norm = 1.0 / norm_sq;
            SimpleQuat {
                x: -self.x * inv_norm,
                y: -self.y * inv_norm,
                z: -self.z * inv_norm,
                w: self.w * inv_norm,
            }
        } else {
            *self
        }
    }
    pub fn normalize(&self) -> Self {
        let norm = (self.x * self.x + self.y * self.y + self.z * self.z + self.w * self.w).sqrt();
        if norm > 0.0 {
            SimpleQuat {
                x: self.x / norm,
                y: self.y / norm,
                z: self.z / norm,
                w: self.w / norm,
            }
        } else {
            *self
        }
    }
}
pub fn compute_humanoid_local_rotation_internal(
    pre_q: WasmQuaternion,
    post_q: WasmQuaternion,
    limit_min: WasmVector3,
    limit_max: WasmVector3,
    muscle_x: f32,
    muscle_y: f32,
    muscle_z: f32,
) -> WasmQuaternion {
    let angle_x = if muscle_x > 0.0 { muscle_x * limit_max.x } else { muscle_x * limit_min.x.abs() };
    let angle_y = if muscle_y > 0.0 { muscle_y * limit_max.y } else { muscle_y * limit_min.y.abs() };
    let angle_z = if muscle_z > 0.0 { muscle_z * limit_max.z } else { muscle_z * limit_min.z.abs() };
    let qx = SimpleQuat::from_axis_angle(1.0, 0.0, 0.0, angle_x);
    let qy = SimpleQuat::from_axis_angle(0.0, 1.0, 0.0, angle_y);
    let qz = SimpleQuat::from_axis_angle(0.0, 0.0, 1.0, angle_z);
    let muscle_rot = qy.multiply(&qx).multiply(&qz);
    let pq = SimpleQuat { x: pre_q.x, y: pre_q.y, z: pre_q.z, w: pre_q.w };
    let poq = SimpleQuat { x: post_q.x, y: post_q.y, z: post_q.z, w: post_q.w };
    let res = pq.multiply(&muscle_rot).multiply(&poq.inverse()).normalize();
    WasmQuaternion {
        x: res.x,
        y: res.y,
        z: res.z,
        w: res.w,
    }
}
#[wasm_bindgen]
pub fn compute_humanoid_local_rotation(
    pre_q_val: &JsValue,
    post_q_val: &JsValue,
    limit_min_val: &JsValue,
    limit_max_val: &JsValue,
    muscle_x: f32,
    muscle_y: f32,
    muscle_z: f32,
) -> JsValue {
    let pre_q: WasmQuaternion = serde_wasm_bindgen::from_value(pre_q_val.clone())
        .unwrap_or(WasmQuaternion { x: 0.0, y: 0.0, z: 0.0, w: 1.0 });
    let post_q: WasmQuaternion = serde_wasm_bindgen::from_value(post_q_val.clone())
        .unwrap_or(WasmQuaternion { x: 0.0, y: 0.0, z: 0.0, w: 1.0 });
    let limit_min: WasmVector3 = serde_wasm_bindgen::from_value(limit_min_val.clone())
        .unwrap_or(WasmVector3 { x: 0.0, y: 0.0, z: 0.0 });
    let limit_max: WasmVector3 = serde_wasm_bindgen::from_value(limit_max_val.clone())
        .unwrap_or(WasmVector3 { x: 0.0, y: 0.0, z: 0.0 });
    let res = compute_humanoid_local_rotation_internal(pre_q, post_q, limit_min, limit_max, muscle_x, muscle_y, muscle_z);
    serde_wasm_bindgen::to_value(&res).unwrap_or(JsValue::NULL)
}
#[wasm_bindgen]
impl Environment {
    #[wasm_bindgen(constructor)]
    pub fn new(data: Vec<u8>) -> Self {
        let mut reader = Reader::new(data, UnityVersion::default());
        let signature = reader.read_string_null();
        reader.pos = 0;
        let mut objects: Vec<ClassType> = Vec::new();
        let mut object_hash = HashMap::new();
        let mut asset_manager = AssetManager::new();
        if signature == "UnityFS" {
            let bundle = Bundle::read(&mut reader).unwrap();
            for entry in bundle.files.iter() {
                if entry.name.ends_with(".resS") || entry.name.ends_with(".resource") {
                    asset_manager.add_raw_file(entry.name.clone(), entry.data.clone());
                } else if entry.data.len() > 20 {
                    let mut asset_reader = Reader::new(entry.data.clone(), bundle.engine_version.clone());
                    let sf = SerializedFile::read(&mut asset_reader);
                    asset_manager.add_file(entry.name.clone(), sf);
                }
            }
            let mut game_objects_map = HashMap::new();
            let mut transforms_map = HashMap::new();
            let mut mono_script_class_map = HashMap::new();
            let mut referenced_textures = std::collections::HashSet::new();
            let mut referenced_meshes = std::collections::HashSet::new();
            for (asset_name, sf) in asset_manager.files.iter() {
                for obj_info in sf.objects.iter() {
                    let class_id = obj_info.class_id;
                    let path_id = obj_info.path_id;
                    if class_id == 1 || class_id == 4 || class_id == 115 || class_id == 21 || class_id == 33 || class_id == 137 {
                        if let Ok(unity_value) = asset_manager.read_object_value(asset_name, 0, path_id) {
                            if class_id == 1 {
                                game_objects_map.insert(path_id, unity_value_to_json(&unity_value));
                            } else if class_id == 4 {
                                transforms_map.insert(path_id, unity_value_to_json(&unity_value));
                            } else if class_id == 115 {
                                let mut class_name = String::new();
                                if let Some(name_val) = unity_value.get("m_Name") {
                                    if let UnityValue::String(name) = name_val {
                                        class_name = name.clone();
                                    }
                                }
                                if class_name.is_empty() {
                                    if let Some(class_name_val) = unity_value.get("m_ClassName") {
                                        if let UnityValue::String(cn) = class_name_val {
                                            class_name = cn.clone();
                                        }
                                    }
                                }
                                if !class_name.is_empty() {
                                    mono_script_class_map.insert(path_id, class_name);
                                }
                            } else if class_id == 21 {
                                collect_pptr_path_ids(&unity_value, &mut referenced_textures);
                            } else if class_id == 33 || class_id == 137 {
                                if let Some(mesh_ptr) = unity_value.get("m_Mesh") {
                                    if let UnityValue::PPtr { path_id: m_path_id, .. } = mesh_ptr {
                                        if *m_path_id != 0 {
                                            referenced_meshes.insert(*m_path_id);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            #[cfg(not(target_arch = "wasm32"))]
            {
                let mut dump_content = String::new();
                for sf in asset_manager.files.values() {
                    if sf.enable_type_tree {
                        for t in &sf.types {
                            if [1, 4, 21, 23, 28, 33, 43, 74, 90, 91, 95, 114, 115, 137, 224].contains(&t.class_id) && !t.nodes.is_empty() {
                                dump_content.push_str(&format!("// DUMP_START CLASS_ID: {}\n", t.class_id));
                                for n in t.nodes.iter() {
                                    dump_content.push_str(&format!(
                                        "nodes.push(TypeTreeNode {{ m_Version: {}, m_Level: {}, m_IsArray: {}, m_ByteSize: {}, m_Index: {}, m_MetaFlag: {}, m_Type: \"{}\".to_string(), m_Name: \"{}\".to_string(), m_TypeStrOffset: 0, m_NameStrOffset: 0, m_RefTypeHash: 0 }});\n",
                                        n.m_Version, n.m_Level, n.m_IsArray, n.m_ByteSize, n.m_Index, n.m_MetaFlag, n.m_Type, n.m_Name
                                    ));
                                }
                                dump_content.push_str(&format!("// DUMP_END CLASS_ID: {}\n", t.class_id));
                            }
                        }
                    }
                }
                if !dump_content.is_empty() {
                    let _ = std::fs::write("typetree_dump.txt", dump_content);
                }
            }
            for (asset_name, sf) in asset_manager.files.iter() {
                for obj_info in sf.objects.iter() {
                    let class_id = obj_info.class_id;
                    let path_id = obj_info.path_id;
                    if class_id == 1 {
                        if let Some(mut json) = game_objects_map.get(&path_id).cloned() {
                            if let serde_json::Value::Object(ref mut map) = json {
                                map.insert("path_id".to_string(), serde_json::Value::String(path_id.to_string()));
                            }
                            objects.push(ClassType::GameObject(json));
                            continue;
                        }
                    } else if class_id == 4 {
                        if let Some(mut json) = transforms_map.get(&path_id).cloned() {
                            if let serde_json::Value::Object(ref mut map) = json {
                                map.insert("path_id".to_string(), serde_json::Value::String(path_id.to_string()));
                            }
                            objects.push(ClassType::Transform(json));
                            continue;
                        }
                    }
                    match asset_manager.read_object_value(asset_name, 0, path_id) {
                        Err(e) => {
                            println!("Error reading object (class_id={}, path_id={}): {}", class_id, path_id, e);
                            objects.push(ClassType::Unknown { path_id, class_id });
                        }
                        Ok(unity_value) => {
                            match class_id {
                                1 => {
                                    let mut json = unity_value_to_json(&unity_value);
                                    if let serde_json::Value::Object(ref mut map) = json {
                                        map.insert("path_id".to_string(), serde_json::Value::String(path_id.to_string()));
                                    }
                                    objects.push(ClassType::GameObject(json));
                                }
                                4 => {
                                    let mut json = unity_value_to_json(&unity_value);
                                    if let serde_json::Value::Object(ref mut map) = json {
                                        map.insert("path_id".to_string(), serde_json::Value::String(path_id.to_string()));
                                    }
                                    objects.push(ClassType::Transform(json));
                                }
                                21 => {
                                    let mut json = unity_value_to_json(&unity_value);
                                    if let serde_json::Value::Object(ref mut map) = json {
                                        map.insert("path_id".to_string(), serde_json::Value::String(path_id.to_string()));
                                    }
                                    objects.push(ClassType::Material(json));
                                }
                                43 => {
                                    let mut resolved_value = unity_value.clone();
                                    let mut stream_info: Option<(u64, u32, String)> = None;
                                    if let Some(UnityValue::Map(mesh_map)) = unity_value.get("m_StreamData") {
                                        let offset = mesh_map.get("offset").and_then(|v| match v {
                                            UnityValue::UInt64(o) => Some(*o),
                                            UnityValue::Int64(o) => Some(*o as u64),
                                            UnityValue::UInt32(o) => Some(*o as u64),
                                            UnityValue::Int32(o) => Some(*o as u64),
                                            _ => None,
                                        });
                                        let size = mesh_map.get("size").and_then(|v| match v {
                                            UnityValue::UInt32(s) => Some(*s),
                                            UnityValue::Int32(s) => Some(*s as u32),
                                            _ => None,
                                        });
                                        let path = mesh_map.get("path").and_then(|v| match v {
                                            UnityValue::String(s) => Some(s.clone()),
                                            _ => None,
                                        });
                                        if let (Some(o), Some(s), Some(p)) = (offset, size, path) {
                                            stream_info = Some((o, s, p));
                                        }
                                    }
                                    if let Some((offset, size, path)) = stream_info {
                                        let stream_name = path.rsplit('/').next().unwrap_or(&path);
                                        if let Some(raw_data) = asset_manager.raw_files.get(stream_name) {
                                            let start = offset as usize;
                                            let end = start + size as usize;
                                            if end <= raw_data.len() {
                                                let payload = raw_data[start..end].to_vec();
                                                if let UnityValue::Map(mesh_map) = &mut resolved_value {
                                                    if let Some(UnityValue::Map(vdata_map)) = mesh_map.get_mut("m_VertexData") {
                                                        vdata_map.insert("m_DataSize".to_string(), UnityValue::Bytes(payload));
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    if let Ok(mesh) = Mesh::try_from_unity_value(&resolved_value) {
                                        let json = process_mesh(&mesh, path_id);
                                        objects.push(ClassType::Mesh(json));
                                        if !referenced_meshes.contains(&path_id) {
                                            println!("Loaded unreferenced mesh as fallback in Environment: name='{}', path_id={}", mesh.m_Name, path_id);
                                        }
                                    }
                                }
                                33 => {
                                    let mut json = unity_value_to_json(&unity_value);
                                    if let serde_json::Value::Object(ref mut map) = json {
                                        map.insert("path_id".to_string(), serde_json::Value::String(path_id.to_string()));
                                        if let Some(mesh_ptr) = unity_value.get("m_Mesh") {
                                            if let UnityValue::PPtr { path_id: m_path_id, .. } = mesh_ptr {
                                                map.insert("mesh_path_id".to_string(), serde_json::Value::String(m_path_id.to_string()));
                                            }
                                        }
                                    }
                                    objects.push(ClassType::MeshFilter(json));
                                }
                                23 => {
                                    let mut json = unity_value_to_json(&unity_value);
                                    if let serde_json::Value::Object(ref mut map) = json {
                                        map.insert("path_id".to_string(), serde_json::Value::String(path_id.to_string()));
                                    }
                                    objects.push(ClassType::MeshRenderer(json));
                                }
                                137 => {
                                    let json = process_skinned_mesh_renderer(&unity_value, path_id);
                                    objects.push(ClassType::SkinnedMeshRenderer(json));
                                }
                                28 => {
                                    let json = process_texture2d(&unity_value, path_id, &asset_manager, &referenced_textures);
                                    objects.push(ClassType::Texture2D(json));
                                }
                                74 => {
                                    let mut json = unity_value_to_json(&unity_value);
                                    if let serde_json::Value::Object(ref mut map) = json {
                                        map.insert("path_id".to_string(), serde_json::Value::String(path_id.to_string()));
                                    }
                                    objects.push(ClassType::AnimationClip(json));
                                }
                                95 => {
                                    let mut json = unity_value_to_json(&unity_value);
                                    if let serde_json::Value::Object(ref mut map) = json {
                                        map.insert("path_id".to_string(), serde_json::Value::String(path_id.to_string()));
                                    }
                                    objects.push(ClassType::Animator(json));
                                }
                                90 => {
                                    let mut json = unity_value_to_json(&unity_value);
                                    if let serde_json::Value::Object(ref mut map) = json {
                                        map.insert("path_id".to_string(), serde_json::Value::String(path_id.to_string()));
                                    }
                                    preprocess_avatar_json(&mut json);
                                    objects.push(ClassType::Avatar(json));
                                }
                                114 => {
                                    let mut json = unity_value_to_json(&unity_value);
                                    if let serde_json::Value::Object(ref mut map) = json {
                                        map.insert("path_id".to_string(), serde_json::Value::String(path_id.to_string()));
                                    }
                                    let mut handled = false;
                                    if let Some(script_ptr) = unity_value.get("m_Script") {
                                        if let UnityValue::PPtr { path_id: script_path_id, .. } = script_ptr {
                                            if let Some(script_name) = mono_script_class_map.get(script_path_id) {
                                                let script_name_lower = script_name.to_lowercase();
                                                if script_name_lower == "springbone" {
                                                    objects.push(ClassType::SpringBone(json.clone()));
                                                    handled = true;
                                                } else if script_name_lower == "dynamicbone" {
                                                    objects.push(ClassType::DynamicBone(json.clone()));
                                                    handled = true;
                                                }
                                            }
                                        }
                                    }
                                    if !handled {
                                        objects.push(ClassType::Unknown { path_id, class_id: 114 });
                                    }
                                }
                                _ => {
                                    objects.push(ClassType::Unknown { path_id, class_id: class_id });
                                }
                            }
                        }
                    }
                }
            }
            fn get_transform_path(tr_id: i64, transforms: &HashMap<i64, serde_json::Value>, game_objects: &HashMap<i64, serde_json::Value>) -> String {
                if let Some(tr) = transforms.get(&tr_id) {
                    let go_id = tr["m_GameObject"]["path_id"]
                        .as_str()
                        .and_then(|s| s.parse::<i64>().ok())
                        .unwrap_or(0);
                    let go_name = if let Some(go) = game_objects.get(&go_id) {
                        go["name"].as_str().unwrap_or("").to_string()
                    } else {
                        "".to_string()
                    };
                    let father_id = tr["m_Father"]["path_id"]
                        .as_str()
                        .and_then(|s| s.parse::<i64>().ok())
                        .unwrap_or(0);
                    if father_id != 0 {
                        let parent_path = get_transform_path(father_id, transforms, game_objects);
                        if parent_path.is_empty() {
                            go_name
                        } else {
                            format!("{}/{}", parent_path, go_name)
                        }
                    } else {
                        go_name
                    }
                } else {
                    "".to_string()
                }
            }
            fn parse_path_id(val: &serde_json::Value) -> i64 {
                val["path_id"]
                    .as_str()
                    .and_then(|s| s.parse::<i64>().ok())
                    .unwrap_or(0)
            }
            for (i, obj) in objects.iter().enumerate() {
                let path_id = match obj {
                    ClassType::GameObject(val) => parse_path_id(val),
                    ClassType::Transform(val) => parse_path_id(val),
                    ClassType::Material(val) => parse_path_id(val),
                    ClassType::Mesh(val) => parse_path_id(val),
                    ClassType::MeshFilter(val) => parse_path_id(val),
                    ClassType::MeshRenderer(val) => parse_path_id(val),
                    ClassType::SkinnedMeshRenderer(val) => parse_path_id(val),
                    ClassType::Texture2D(val) => parse_path_id(val),
                    ClassType::TextAsset(val) => parse_path_id(val),
                    ClassType::AnimationClip(val) => parse_path_id(val),
                    ClassType::Animator(val) => parse_path_id(val),
                    ClassType::Avatar(val) => parse_path_id(val),
                    ClassType::SpringBone(val) => parse_path_id(val),
                    ClassType::DynamicBone(val) => parse_path_id(val),
                    ClassType::AssetBundle(val) => parse_path_id(val),
                    ClassType::Unknown { path_id, .. } => *path_id,
                };
                if path_id != 0 {
                    object_hash.insert(path_id.to_string(), i.to_string());
                }
                if let ClassType::Transform(val) = obj {
                    let tr_id = parse_path_id(val);
                    let path = get_transform_path(tr_id, &transforms_map, &game_objects_map);
                    if !path.is_empty() {
                        let hash = crc32fast::hash(path.as_bytes());
                        object_hash.insert(hash.to_string(), path.clone());
                        let mut current_suffix = &path[..];
                        while let Some(pos) = current_suffix.find('/') {
                            current_suffix = &current_suffix[pos + 1..];
                            if !current_suffix.is_empty() {
                                let suffix_hash = crc32fast::hash(current_suffix.as_bytes());
                                object_hash.insert(suffix_hash.to_string(), current_suffix.to_string());
                            }
                        }
                    }
                }
            }
        }
        Self {
            objects,
            object_hash,
            asset_manager,
        }
    }
    #[wasm_bindgen]
    pub fn getObjects(&self) -> String {
        serde_json::to_string(&self.objects).unwrap_or_else(|_| "[]".to_string())
    }
    #[wasm_bindgen]
    pub fn getObjectHash(&self) -> String {
        serde_json::to_string(&self.object_hash).unwrap_or_else(|_| "{}".to_string())
    }
    fn read_object(&self, path_id: i64, source_file: Option<String>, expected_class_id: Option<i32>) -> Option<UnityValue> {
        let simplified_source = source_file.as_ref().map(|s| simplify_name_rust(s));
        let has_matching_object = |sf: &SerializedFile| {
            sf.objects.iter().any(|obj| {
                obj.path_id == path_id && expected_class_id.map_or(true, |expected| obj.class_id == expected)
            })
        };
        if let Some(ref source_name) = simplified_source {
            let is_bundle = source_name.ends_with(".unity3d") || source_name.ends_with(".ab");
            for (asset_name, sf) in self.asset_manager.files.iter() {
                let simplified_asset = simplify_name_rust(asset_name);
                let is_match = simplified_asset.contains(source_name)
                    || source_name.contains(&simplified_asset)
                    || (is_bundle && simplified_asset.starts_with("cab-"));
                if is_match && has_matching_object(sf) {
                    if let Some(val) = self.read_object_from_file(asset_name, path_id) {
                        return Some(val);
                    }
                }
            }
        }
        for (asset_name, sf) in self.asset_manager.files.iter() {
            if let Some(ref source_name) = simplified_source {
                let is_bundle = source_name.ends_with(".unity3d") || source_name.ends_with(".ab");
                let simplified_asset = simplify_name_rust(asset_name);
                let was_checked = simplified_asset.contains(source_name)
                    || source_name.contains(&simplified_asset)
                    || (is_bundle && simplified_asset.starts_with("cab-"));
                if was_checked {
                    continue;
                }
            }
            if has_matching_object(sf) {
                if let Some(val) = self.read_object_from_file(asset_name, path_id) {
                    return Some(val);
                }
            }
        }
        None
    }
    fn read_object_from_file(&self, asset_name: &str, path_id: i64) -> Option<UnityValue> {
        match self.asset_manager.read_object_value(asset_name, 0, path_id) {
            Ok(mut unity_value) => {
                let mut stream_info: Option<(u64, u32, String)> = None;
                if let Some(UnityValue::Map(mesh_map)) = unity_value.get("m_StreamData") {
                    let offset = mesh_map.get("offset").and_then(|v| match v {
                        UnityValue::UInt64(o) => Some(*o),
                        UnityValue::Int64(o) => Some(*o as u64),
                        UnityValue::UInt32(o) => Some(*o as u64),
                        UnityValue::Int32(o) => Some(*o as u64),
                        _ => None,
                    });
                    let size = mesh_map.get("size").and_then(|v| match v {
                        UnityValue::UInt32(s) => Some(*s),
                        UnityValue::Int32(s) => Some(*s as u32),
                        _ => None,
                    });
                    let path = mesh_map.get("path").and_then(|v| match v {
                        UnityValue::String(s) => Some(s.clone()),
                        _ => None,
                    });
                    if let (Some(o), Some(s), Some(p)) = (offset, size, path) {
                        stream_info = Some((o, s, p));
                    }
                }
                if let Some((offset, size, path)) = stream_info {
                    let stream_name = path.rsplit('/').next().unwrap_or(&path);
                    if let Some(raw_data) = self.asset_manager.raw_files.get(stream_name) {
                        let start = offset as usize;
                        let end = start + size as usize;
                        if end <= raw_data.len() {
                            let payload = raw_data[start..end].to_vec();
                            if let UnityValue::Map(mesh_map) = &mut unity_value {
                                if let Some(UnityValue::Map(vdata_map)) = mesh_map.get_mut("m_VertexData") {
                                    vdata_map.insert("m_DataSize".to_string(), UnityValue::Bytes(payload));
                                }
                            }
                        }
                    }
                }
                Some(unity_value)
            }
            Err(_) => {
                None
            }
        }
    }
    fn parse_path_id(val: &JsValue) -> Option<i64> {
        if let Some(s) = val.as_string() {
            if let Ok(n) = s.parse::<i64>() {
                return Some(n);
            }
        }
        if let Some(n) = val.as_f64() {
            if n.is_finite() && n.fract() == 0.0 {
                let min = i64::MIN as f64;
                let max = i64::MAX as f64;
                let js_safe_min = -(1_i64 << 53) as f64;
                let js_safe_max = ((1_i64 << 53) - 1) as f64;
                if n >= min && n <= max && n >= js_safe_min && n <= js_safe_max {
                    return Some(n as i64);
                }
            }
        }
        if let Ok(n) = serde_wasm_bindgen::from_value::<i64>(val.clone()) {
            return Some(n);
        }
        None
    }
    #[wasm_bindgen]
    pub fn getMeshVertices(&self, path_id: JsValue, source_file: JsValue) -> Option<Float32Array> {
        let path_id = Self::parse_path_id(&path_id)?;
        let src_file = source_file.as_string();
        let val = self.read_object(path_id, src_file, Some(43))?;
        let mesh = Mesh::try_from_unity_value(&val).ok()?;
        let verts = mesh.get_vertices().ok()?;
        let mut flat = Vec::with_capacity(verts.len() * 3);
        for v in verts {
            flat.push(v.x);
            flat.push(v.y);
            flat.push(v.z);
        }
        Some(Float32Array::from(flat.as_slice()))
    }
    #[wasm_bindgen]
    pub fn getMeshNormals(&self, path_id: JsValue, source_file: JsValue) -> Option<Float32Array> {
        let path_id = Self::parse_path_id(&path_id)?;
        let src_file = source_file.as_string();
        let val = self.read_object(path_id, src_file, Some(43))?;
        let mesh = Mesh::try_from_unity_value(&val).ok()?;
        let norms = mesh.get_normals().ok()?;
        let mut flat = Vec::with_capacity(norms.len() * 3);
        for n in norms {
            flat.push(n.x);
            flat.push(n.y);
            flat.push(n.z);
        }
        Some(Float32Array::from(flat.as_slice()))
    }
    #[wasm_bindgen]
    pub fn getMeshUVs(&self, path_id: JsValue, source_file: JsValue) -> Option<Float32Array> {
        let path_id = Self::parse_path_id(&path_id)?;
        let src_file = source_file.as_string();
        let val = self.read_object(path_id, src_file, Some(43))?;
        let mesh = Mesh::try_from_unity_value(&val).ok()?;
        let uvs = mesh.extract_uvs().ok()?;
        let mut flat = Vec::with_capacity(uvs.len() * 2);
        for (u, v) in uvs {
            flat.push(u);
            flat.push(v);
        }
        Some(Float32Array::from(flat.as_slice()))
    }
    #[wasm_bindgen]
    pub fn getMeshIndices(&self, path_id: JsValue, source_file: JsValue) -> Option<Uint32Array> {
        let path_id = Self::parse_path_id(&path_id)?;
        let src_file = source_file.as_string();
        let val = self.read_object(path_id, src_file, Some(43))?;
        let mesh = Mesh::try_from_unity_value(&val).ok()?;
        let indices = mesh.get_indices().ok()?;
        Some(Uint32Array::from(indices.as_slice()))
    }
    fn val_to_f32(v: &UnityValue) -> f32 {
        match v {
            UnityValue::Float(f) => *f,
            UnityValue::Double(d) => *d as f32,
            UnityValue::Int8(i) => *i as f32,
            UnityValue::UInt8(u) => *u as f32,
            UnityValue::Int16(i) => *i as f32,
            UnityValue::UInt16(u) => *u as f32,
            UnityValue::Int32(i) => *i as f32,
            UnityValue::UInt32(u) => *u as f32,
            UnityValue::Int64(i) => *i as f32,
            UnityValue::UInt64(u) => *u as f32,
            _ => 0.0,
        }
    }
    fn val_to_u32(v: &UnityValue) -> u32 {
        match v {
            UnityValue::Int32(i) => *i as u32,
            UnityValue::UInt32(u) => *u,
            UnityValue::Int8(i) => *i as u32,
            UnityValue::UInt8(u) => *u as u32,
            UnityValue::Int16(i) => *i as u32,
            UnityValue::UInt16(u) => *u as u32,
            UnityValue::Int64(i) => *i as u32,
            UnityValue::UInt64(u) => *u as u32,
            UnityValue::Float(f) => *f as u32,
            _ => 0,
        }
    }
    fn extract_skin_from_value(val: &UnityValue) -> Option<(Vec<u32>, Vec<f32>)> {
        let m_skin = val.get("m_Skin")?;
        if let UnityValue::Array(arr) = m_skin {
            let mut indices = Vec::with_capacity(arr.len() * 4);
            let mut weights = Vec::with_capacity(arr.len() * 4);
            for item in arr {
                let mut b_idx = [0u32; 4];
                if let Some(bi_val) = item.get("boneIndex") {
                    if let UnityValue::Array(bi_arr) = bi_val {
                        for (i, v) in bi_arr.iter().enumerate().take(4) {
                            b_idx[i] = Self::val_to_u32(v);
                        }
                    }
                } else {
                    b_idx[0] = item.get("boneIndex0").map(Self::val_to_u32).unwrap_or(0);
                    b_idx[1] = item.get("boneIndex1").map(Self::val_to_u32).unwrap_or(0);
                    b_idx[2] = item.get("boneIndex2").map(Self::val_to_u32).unwrap_or(0);
                    b_idx[3] = item.get("boneIndex3").map(Self::val_to_u32).unwrap_or(0);
                }
                let mut w_val = [0.0f32; 4];
                if let Some(we_val) = item.get("weight") {
                    if let UnityValue::Array(we_arr) = we_val {
                        for (i, v) in we_arr.iter().enumerate().take(4) {
                            w_val[i] = Self::val_to_f32(v);
                        }
                    }
                } else {
                    w_val[0] = item.get("weight0").map(Self::val_to_f32).unwrap_or(0.0);
                    w_val[1] = item.get("weight1").map(Self::val_to_f32).unwrap_or(0.0);
                    w_val[2] = item.get("weight2").map(Self::val_to_f32).unwrap_or(0.0);
                    w_val[3] = item.get("weight3").map(Self::val_to_f32).unwrap_or(0.0);
                }
                indices.extend_from_slice(&b_idx);
                weights.extend_from_slice(&w_val);
            }
            Some((indices, weights))
        } else {
            None
        }
    }
    #[wasm_bindgen]
    pub fn getMeshSkinIndices(&self, path_id: JsValue, source_file: JsValue) -> Option<Uint32Array> {
        let path_id = Self::parse_path_id(&path_id)?;
        let src_file = source_file.as_string();
        let val = self.read_object(path_id, src_file, Some(43))?;
        if let Some((indices, _)) = Self::extract_skin_from_value(&val) {
            let slice: &[u32] = indices.as_slice();
            return Some(Uint32Array::from(slice));
        }
        let mesh = Mesh::try_from_unity_value(&val).ok()?;
        let indices = mesh.extract_bone_indices().ok()?;
        let mut flat = Vec::with_capacity(indices.len() * 4);
        for idx in indices {
            flat.push(idx[0]);
            flat.push(idx[1]);
            flat.push(idx[2]);
            flat.push(idx[3]);
        }
        Some(Uint32Array::from(flat.as_slice()))
    }
    #[wasm_bindgen]
    pub fn getMeshSkinWeights(&self, path_id: JsValue, source_file: JsValue) -> Option<Float32Array> {
        let path_id = Self::parse_path_id(&path_id)?;
        let src_file = source_file.as_string();
        let val = self.read_object(path_id, src_file, Some(43))?;
        if let Some((_, weights)) = Self::extract_skin_from_value(&val) {
            let slice: &[f32] = weights.as_slice();
            return Some(Float32Array::from(slice));
        }
        let mesh = Mesh::try_from_unity_value(&val).ok()?;
        let weights = mesh.extract_bone_weights().ok()?;
        let mut flat = Vec::with_capacity(weights.len() * 4);
        for w in weights {
            flat.push(w.x);
            flat.push(w.y);
            flat.push(w.z);
            flat.push(w.w);
        }
        Some(Float32Array::from(flat.as_slice()))
    }
    #[wasm_bindgen]
    pub fn getTextureData(&self, path_id: JsValue, source_file: JsValue) -> Option<Uint8Array> {
        let path_id = Self::parse_path_id(&path_id)?;
        let src_file = source_file.as_string();
        let val = self.read_object(path_id, src_file, Some(28))?;
        let tex = Texture2D::try_from_unity_value(&val).ok()?;
        let mut payload: Option<Vec<u8>> = None;
        if let Some(data) = &tex.image_data {
            if !data.0.is_empty() {
                payload = Some(data.0.clone());
            }
        }
        if payload.is_none() {
            if let Some(stream) = &tex.m_StreamData {
                if stream.size > 0 {
                    let stream_name = stream.path.rsplit('/').next().unwrap_or(&stream.path);
                    if let Some(raw_data) = self.asset_manager.raw_files.get(stream_name) {
                        let offset = stream.offset as usize;
                        let size = stream.size as usize;
                        if offset + size <= raw_data.len() {
                            payload = Some(raw_data[offset..offset+size].to_vec());
                        }
                    }
                }
            }
        }
        let data = payload?;
        let rgba = decompress_texture(tex.m_Width as usize, tex.m_Height as usize, tex.m_TextureFormat, &data)?;
        Some(Uint8Array::from(rgba.as_slice()))
    }
    #[wasm_bindgen]
    pub fn getTransformedMeshVertices(&self, path_id: JsValue, source_file: JsValue, matrix: Vec<f32>) -> Option<Float32Array> {
        let path_id = Self::parse_path_id(&path_id)?;
        let src_file = source_file.as_string();
        let val = self.read_object(path_id, src_file, Some(43))?;
        let mesh = Mesh::try_from_unity_value(&val).ok()?;
        let verts = mesh.get_vertices().ok()?;
        let m: [f32; 16] = matrix.try_into().ok()?;
        let mut flat = Vec::with_capacity(verts.len() * 3);
        for v in verts {
            let (tx, ty, tz) = transform_coordinate(&m, v.x, v.y, v.z);
            flat.push(tx);
            flat.push(ty);
            flat.push(tz);
        }
        Some(Float32Array::from(flat.as_slice()))
    }
    #[wasm_bindgen]
    pub fn getTransformedMeshNormals(&self, path_id: JsValue, source_file: JsValue, matrix: Vec<f32>) -> Option<Float32Array> {
        let path_id = Self::parse_path_id(&path_id)?;
        let src_file = source_file.as_string();
        let val = self.read_object(path_id, src_file, Some(43))?;
        let mesh = Mesh::try_from_unity_value(&val).ok()?;
        let norms = mesh.get_normals().ok()?;
        let m: [f32; 16] = matrix.try_into().ok()?;
        let mut flat = Vec::with_capacity(norms.len() * 3);
        for n in norms {
            let (tx, ty, tz) = transform_normal(&m, n.x, n.y, n.z);
            flat.push(tx);
            flat.push(ty);
            flat.push(tz);
        }
        Some(Float32Array::from(flat.as_slice()))
    }
}
#[inline(always)]
fn transform_coordinate(m: &[f32; 16], x: f32, y: f32, z: f32) -> (f32, f32, f32) {
    #[cfg(target_arch = "wasm32")]
    {
        use std::arch::wasm32::*;
        unsafe {
            let vx = f32x4_splat(x);
            let vy = f32x4_splat(y);
            let vz = f32x4_splat(z);
            let vw = f32x4_splat(1.0);
            let col0 = v128_load(m.as_ptr() as *const v128);
            let col1 = v128_load(m.as_ptr().add(4) as *const v128);
            let col2 = v128_load(m.as_ptr().add(8) as *const v128);
            let col3 = v128_load(m.as_ptr().add(12) as *const v128);
            let res = f32x4_add(
                f32x4_add(f32x4_mul(col0, vx), f32x4_mul(col1, vy)),
                f32x4_add(f32x4_mul(col2, vz), f32x4_mul(col3, vw))
            );
            let mut out = [0.0f32; 4];
            v128_store(out.as_mut_ptr() as *mut v128, res);
            (out[0], out[1], out[2])
        }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let rx = x * m[0] + y * m[4] + z * m[8] + m[12];
        let ry = x * m[1] + y * m[5] + z * m[9] + m[13];
        let rz = x * m[2] + y * m[6] + z * m[10] + m[14];
        (rx, ry, rz)
    }
}
#[inline(always)]
fn transform_normal(m: &[f32; 16], x: f32, y: f32, z: f32) -> (f32, f32, f32) {
    #[cfg(target_arch = "wasm32")]
    {
        use std::arch::wasm32::*;
        unsafe {
            let vx = f32x4_splat(x);
            let vy = f32x4_splat(y);
            let vz = f32x4_splat(z);
            let col0 = v128_load(m.as_ptr() as *const v128);
            let col1 = v128_load(m.as_ptr().add(4) as *const v128);
            let col2 = v128_load(m.as_ptr().add(8) as *const v128);
            let res = f32x4_add(
                f32x4_mul(col0, vx),
                f32x4_add(f32x4_mul(col1, vy), f32x4_mul(col2, vz))
            );
            let mut out = [0.0f32; 4];
            v128_store(out.as_mut_ptr() as *mut v128, res);
            (out[0], out[1], out[2])
        }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let rx = x * m[0] + y * m[4] + z * m[8];
        let ry = x * m[1] + y * m[5] + z * m[9];
        let rz = x * m[2] + y * m[6] + z * m[10];
        (rx, ry, rz)
    }
}
