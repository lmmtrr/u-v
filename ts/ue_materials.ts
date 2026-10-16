import type { UnrealMaterialInfo } from "./types";

const BASE_COLOR_PARAM =
  /^(base_?colou?r(_?(map|tex(ture)?))?|diffuse(_?(colou?r|map|tex(ture)?))?|albedo(_?(map|tex(ture)?))?|texture_?base|base_?(map|tex(ture)?)|main_?tex(ture)?|colou?r_?(map|tex(ture)?)?|tex_?d)$/i;
const BASE_COLOR_TEXTURE = /(_d|_bc|_col|_colou?r|_basecolou?r|_diffuse|_albedo|C)$/;
const NON_COLOR = /normal|mask|rough|metal|spec|_?ao$|occlusion|shadow|line|id_?map|matcap|ramp|emiss|material_?map|height|depth|noise|flow/i;
const LINE_COLOR_PARAM = /^(line_?colou?r|outline_?(colou?r|tex(ture)?)?)$/i;
const textureName = (path: string) => path.split("/").pop() || path;

export const pickBaseColorTexture = (info: UnrealMaterialInfo): string | null => {
  const byParam = info.textures.find((t) => BASE_COLOR_PARAM.test(t.name));
  if (byParam) return byParam.texture;
  const byName = info.textures.find(
    (t) => BASE_COLOR_TEXTURE.test(textureName(t.texture)) && !NON_COLOR.test(t.name),
  );
  if (byName) return byName.texture;
  const firstColor = info.textures.find(
    (t) => !NON_COLOR.test(t.name) && !NON_COLOR.test(textureName(t.texture)),
  );
  return firstColor?.texture ?? null;
};

export const pickLineColorTexture = (info: UnrealMaterialInfo): string | null =>
  info.textures.find((t) => LINE_COLOR_PARAM.test(t.name))?.texture ?? null;
