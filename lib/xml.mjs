// Pieni, riippuvuudeton XML → objekti -jäsennin RSS-, Atom-, CAP- ja FMI WFS -syötteille.
// Nimiavaruuden etuliitteet poistetaan, attribuutit ohitetaan. Elementti, jossa on
// vain tekstiä, muuttuu merkkijonoksi; toistuvat lapsielementit muuttuvat taulukoiksi.

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENT[e] ?? m;
  });
}

const local = (name) => name.slice(name.indexOf(":") + 1);

function finish(node) {
  const keys = Object.keys(node.children);
  const text = node.text.trim();
  if (!keys.length) return text;
  const out = node.children;
  if (text) out["#text"] = text;
  return out;
}

function addChild(parent, name, value) {
  const c = parent.children;
  if (!(name in c)) c[name] = value;
  else if (Array.isArray(c[name])) c[name].push(value);
  else c[name] = [c[name], value];
}

export function parseXml(xml) {
  const root = { name: "#root", children: {}, text: "" };
  const stack = [root];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) {
      stack[stack.length - 1].text += decode(xml.slice(i));
      break;
    }
    if (lt > i) stack[stack.length - 1].text += decode(xml.slice(i, lt));
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3;
    } else if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      stack[stack.length - 1].text += xml.slice(lt + 9, end === -1 ? n : end);
      i = end === -1 ? n : end + 3;
    } else if (xml[lt + 1] === "?" || xml[lt + 1] === "!") {
      const end = xml.indexOf(">", lt);
      i = end === -1 ? n : end + 1;
    } else if (xml[lt + 1] === "/") {
      const end = xml.indexOf(">", lt);
      const node = stack.pop();
      if (stack.length) addChild(stack[stack.length - 1], node.name, finish(node));
      else stack.push(node);
      i = end === -1 ? n : end + 1;
    } else {
      // Avaava tagi; etsi '>' joka ei ole lainausmerkkien sisällä.
      let j = lt + 1, q = null;
      for (; j < n; j++) {
        const ch = xml[j];
        if (q) { if (ch === q) q = null; }
        else if (ch === '"' || ch === "'") q = ch;
        else if (ch === ">") break;
      }
      const raw = xml.slice(lt + 1, j);
      const selfClosing = raw.endsWith("/");
      const name = local(raw.replace(/\/$/, "").trim().split(/\s+/)[0]);
      const node = { name, children: {}, text: "" };
      if (selfClosing) addChild(stack[stack.length - 1], name, "");
      else stack.push(node);
      i = j + 1;
    }
  }
  while (stack.length > 1) {
    const node = stack.pop();
    addChild(stack[stack.length - 1], node.name, finish(node));
  }
  return root.children;
}
