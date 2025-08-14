function renderKatex() {
    let macros = {}
    if (customElements) {
        class KatexInline extends HTMLElement {
            constructor() {
                super();
                katex.render(this.innerText, this, { throwOnError: false, displayMode: false, macros: macros, output: "html" });
            }
        }
        customElements.define("k-x", KatexInline)

        class KatexBlock extends HTMLElement {
            constructor() {
                super();
                katex.render(this.innerText, this, { throwOnError: false, displayMode: true, macros: macros, output: "html" });
            }
        }
        customElements.define("k-b", KatexBlock)
    } else {
        document.querySelectorAll("k-x").forEach(
            (el) => {
                katex.render(el.innerText, el, { throwOnError: false, displayMode: false, macros: macros, output: "html" });
            }
        )
        document.querySelectorAll("k-b").forEach(
            (el) => {
                katex.render(el.innerText, el, { throwOnError: false, displayMode: true, macros: macros, output: "html" });
            }
        )
    }
}
