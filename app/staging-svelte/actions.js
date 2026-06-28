// CSP-clean dynamic styling (A55 / S18). `style-src 'self'` forbids inline style="" attributes, so
// data-driven styles (chart swatches, bar widths/colors) are applied via the CSSOM instead — which
// CSP does NOT gate (script-src already controls the script that runs this). Usage:
//   <span use:styleProps={{ '--sw': color, width: pct + '%', background: tone }}>
// Keys are CSS property names (custom props allowed); null/undefined clears the property.
export function styleProps(node, props = {}) {
  const apply = p => {
    for (const k in p) node.style.setProperty(k, p[k] == null ? '' : String(p[k]));
  };
  apply(props);
  return { update: apply };
}
