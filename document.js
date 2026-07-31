(function () {
  "use strict";

  const documents = {
    deliverable: {
      file: "./cloud-agent-sandbox-deliverable-vi.md",
      title: "Deliverable rút gọn",
      description: "Kiến trúc, UX design, Happy Path, Failure Cases và Abuse Cases — không lặp lại phần nghiên cứu nền."
    },
    research: {
      file: "./cloud-agent-sandbox-architecture-vi.md",
      title: "Kiến trúc & nghiên cứu đầy đủ",
      description: "Bản nghiên cứu nền và lập luận kiến trúc chi tiết cho Cloud Agent Sandbox."
    }
  };

  const requested = new URLSearchParams(location.search).get("doc");
  const key = documents[requested] ? requested : "deliverable";
  const config = documents[key];
  const body = document.querySelector("#document-body");
  const toc = document.querySelector("#toc");

  function escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function inline(text) {
    let value = escapeHtml(text);
    value = value.replace(/`([^`]+)`/g, "<code>$1</code>");
    value = value.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    value = value.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return value;
  }

  function slugify(text, used) {
    const base = text.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "section";
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    return count ? `${base}-${count + 1}` : base;
  }

  function isTableSeparator(line) {
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  }

  function tableCells(line) {
    return line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
  }

  function markdownToHtml(source) {
    const lines = source.replace(/\r\n/g, "\n").split("\n");
    const output = [];
    const headings = [];
    const used = new Map();
    let paragraph = [];
    let listType = null;
    let inCode = false;
    let codeLanguage = "";
    let codeLines = [];
    let quoteLines = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      output.push(`<p>${inline(paragraph.join(" "))}</p>`);
      paragraph = [];
    };
    const flushList = () => {
      if (!listType) return;
      output.push(`</${listType}>`);
      listType = null;
    };
    const flushQuote = () => {
      if (!quoteLines.length) return;
      output.push(`<blockquote><p>${inline(quoteLines.join(" "))}</p></blockquote>`);
      quoteLines = [];
    };

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (inCode) {
        if (/^```/.test(line)) {
          output.push(`<pre><code${codeLanguage ? ` data-language="${escapeHtml(codeLanguage)}"` : ""}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
          inCode = false;
          codeLanguage = "";
          codeLines = [];
        } else codeLines.push(line);
        continue;
      }

      const fence = line.match(/^```\s*(.*)$/);
      if (fence) {
        flushParagraph(); flushList(); flushQuote();
        inCode = true;
        codeLanguage = fence[1].trim();
        continue;
      }

      if (line.startsWith(">")) {
        flushParagraph(); flushList();
        quoteLines.push(line.replace(/^>\s?/, ""));
        continue;
      }
      flushQuote();

      const heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        flushParagraph(); flushList();
        const level = heading[1].length;
        const text = heading[2].replace(/\s+#+$/, "");
        const id = slugify(text, used);
        output.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
        if (level <= 3) headings.push({ level, text, id });
        continue;
      }

      if (index + 1 < lines.length && line.includes("|") && isTableSeparator(lines[index + 1])) {
        flushParagraph(); flushList();
        const headers = tableCells(line);
        const rows = [];
        index += 2;
        while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
          rows.push(tableCells(lines[index]));
          index += 1;
        }
        index -= 1;
        output.push(`<div class="table-wrap"><table><thead><tr>${headers.map(cell => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        continue;
      }

      const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        flushParagraph();
        const type = ordered ? "ol" : "ul";
        if (listType !== type) {
          flushList();
          output.push(`<${type}>`);
          listType = type;
        }
        output.push(`<li>${inline((ordered || unordered)[1])}</li>`);
        continue;
      }

      if (!line.trim()) {
        flushParagraph(); flushList();
        continue;
      }

      paragraph.push(line.trim());
    }

    flushParagraph(); flushList(); flushQuote();
    if (inCode) output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    return { html: output.join("\n"), headings };
  }

  async function loadDocument() {
    document.title = `${config.title} · Cloud Agent Sandbox`;
    document.querySelector("#document-title").textContent = config.title;
    document.querySelector("#toc-title").textContent = config.title;
    document.querySelector("#document-description").textContent = config.description;
    document.querySelector("#document-kicker").textContent = key === "deliverable" ? "≤ 3.000 từ" : "Nghiên cứu đầy đủ";
    document.querySelector("#raw-link").href = config.file;
    document.querySelectorAll("[data-document]").forEach(link => link.classList.toggle("active", link.dataset.document === key));

    try {
      const response = await fetch(config.file);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const source = await response.text();
      const rendered = markdownToHtml(source);
      body.innerHTML = rendered.html;
      toc.innerHTML = rendered.headings
        .filter(heading => heading.level >= 2)
        .map(heading => `<a class="level-${heading.level}" href="#${heading.id}">${escapeHtml(heading.text)}</a>`)
        .join("");
    } catch (error) {
      body.innerHTML = `<div class="document-error"><strong>Không thể tải tài liệu.</strong><br>Hãy mở trang này qua GitHub Pages hoặc một static web server. (${escapeHtml(error.message)})</div>`;
    }
  }

  loadDocument();
})();
