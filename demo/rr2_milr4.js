// rr2_milr4.js (agent milr4, Oct 22 evening): Milos interior from Ryan's photos (curved soffit with its ring of lights, copper lanterns,
// track spots, panelled upper walls, blue mosaic kitchen end with the stainless open kitchen and the Milos crate market, columns,
// straight white cloths with table settings) is data/gjM2c/030.glb, lit by its own Cycles lightmap (milr4). The pieces it replaces
// (draped cloths and orchids, the tan back band Mesh_2262, the kitchen photo card Mesh_240, the old bar soffit, the two old lanterns,
// tables md2 and md11 that stood behind the kitchen end wall) are parked in the .blend and taken out here. RR_FLAGS.nomilr4hide keeps them.
export const MILR4_HIDE_RE = new RegExp("^(Mesh_2249|Mesh_2262|Mesh_2263|Mesh_2373|Mesh_240|Mesh_602|bottle_374|bottle_375|bottle_376|bottle_377|bottle_378|bottle_380|md0_mi_cloth0|md0_mi_orchid0|md0_mi_tabletop0|md11_mi_cloth0|md11_mi_orchid0|md11_mi_tabletop0|md1_mi_cloth0|md1_mi_orchid0|md1_mi_tabletop0|md2_mi_cloth0|md2_mi_orchid0|md2_mi_tabletop0|md3_mi_cloth0|md3_mi_orchid0|md3_mi_tabletop0|md4_mi_cloth0|md4_mi_orchid0|md4_mi_tabletop0|md5_mi_cloth0|md5_mi_orchid0|md5_mi_tabletop0|md6_mi_cloth0|md6_mi_orchid0|md6_mi_tabletop0|md7_mi_cloth0|md7_mi_orchid0|md7_mi_tabletop0|md8_mi_cloth0|md8_mi_orchid0|md8_mi_tabletop0|md9_mi_cloth0|md9_mi_orchid0|md9_mi_tabletop0|mi_bell0|mi_bell1|mi_cord0|mi_cord1|mil_banquette|mil_bt0|mil_bt1|mil_bt2|mil_bt3|mil_bt4|mil_bt5|mil_bt6|mil_lant0_bulb|mil_lant0_chain|mil_lant0_copper|mil_lant0_glass|mil_lant1_bulb|mil_lant1_chain|mil_lant1_copper|mil_lant1_glass|milbar_downlights|milbar_soffit|milbar_soffit_reveal|milc_chair_md11_s0|milc_chair_md11_s2|milc_chair_md2_s1|milc_chair_md2_s3|milc_chair_mil_bt0_s0|milc_chair_mil_bt1_s0|milc_chair_mil_bt2_s0|milc_chair_mil_bt3_s0|milc_chair_mil_bt4_s0|milc_chair_mil_bt5_s0|milc_chair_mil_bt6_s0)$");
export function milr4Apply(root) {
  if ((globalThis.RR_FLAGS || {}).nomilr4hide) return 0;
  const gone = []; root.traverse(o => { if (o.isMesh && MILR4_HIDE_RE.test(o.userData.invName || o.name)) gone.push(o); });
  for (const o of gone) { o.visible = false; o.removeFromParent(); }
  return gone.length;
}
