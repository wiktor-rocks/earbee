// The splash's colours, from the theme showing now: main.js passes them in
// the URL (?bg=…&text=…&accent=…), as "#rrggbb".
const query = new URLSearchParams(location.search);
for (const name of ["bg", "text", "accent"]) {
  const value = query.get(name);
  if (value && /^#[0-9a-f]{6}$/i.test(value)) document.documentElement.style.setProperty(`--${name}`, value);
}
