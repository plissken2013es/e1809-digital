// Tiny DOM helpers (from 48_1997_EscapeFromNY).

/**
 * h('button.primary', { onclick }, 'Roll')
 * @param {string} spec  tag with optional .classes and #id
 * @param {Record<string, any> | null} [props]
 * @param {...any} children  strings, nodes, arrays, null/false (skipped)
 */
export function h(spec, props = null, ...children) {
    const [, tag = 'div', rest = ''] = spec.match(/^([a-z0-9]*)(.*)$/i) ?? [];
    const e = document.createElement(tag || 'div');
    for (const part of rest.match(/[.#][^.#]+/g) ?? []) {
        if (part[0] === '.') e.classList.add(part.slice(1));
        else e.id = part.slice(1);
    }
    for (const [k, v] of Object.entries(props ?? {})) {
        if (v == null || v === false) continue;
        if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') {
            for (const [prop, val] of Object.entries(v)) {
                if (prop.startsWith('--')) e.style.setProperty(prop, val);
                else e.style[prop] = val;
            }
        }
        else if (k === 'dataset') Object.assign(e.dataset, v);
        else if (k in e && typeof v !== 'string') e[k] = v;
        else e.setAttribute(k, v === true ? '' : v);
    }
    append(e, children);
    return e;
}

function append(e, children) {
    for (const c of children) {
        if (c == null || c === false) continue;
        if (Array.isArray(c)) append(e, c);
        else e.append(c instanceof Node ? c : String(c));
    }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
