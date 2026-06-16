export function createDiyAdapter() {
  return {
    engine: "native-canvas",
    note: "当前初版使用原生 Canvas 实现蒙版裁剪与变换；后续可在此封装 DIY.JS 的 stage/addDiyArea API。"
  };
}
