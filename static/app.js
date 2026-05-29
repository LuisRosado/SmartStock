/* ============================================================
   SmartStock Chat — app.js (mejorado)
   ============================================================ */

'use strict';

// ── DOM Elements ───────────────────────────────────────────
const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const messages = document.querySelector("#messages");
const suggestions = document.querySelector("#suggestions");
const statusBadge = document.querySelector("#status");
const supplierContact = document.querySelector("#supplier-contact");

// ── Utilities ──────────────────────────────────────────────
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function createMessageAvatar() {
  return `
    <div class="message-avatar">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L2 7L12 12L22 7L12 2Z"/>
        <path d="M2 17L12 22L22 17"/>
        <path d="M2 12L12 17L22 12"/>
      </svg>
    </div>
  `;
}

// ── Markdown Renderer ──────────────────────────────────────
function renderMarkdown(text) {
  const lines = escapeHtml(text).split(/\r?\n/);
  const html = [];
  let listType = null;

  function closeList() {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  }

  function inline(value) {
    return value
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>");
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }

    // Headings (bold lines)
    if (trimmed.startsWith("**") && trimmed.endsWith("**") && trimmed.length > 4) {
      closeList();
      html.push(`<h3>${inline(trimmed.slice(2, -2))}</h3>`);
      continue;
    }

    // Numbered list
    const numbered = trimmed.match(/^\d+\.\s+(.*)$/);
    if (numbered) {
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      html.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }

    // Bullet list
    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }

    // Regular paragraph
    closeList();
    html.push(`<p>${inline(trimmed)}</p>`);
  }

  closeList();
  return html.join("");
}

// ── Message Functions ──────────────────────────────────────
function addMessage(text, role) {
  // Remove typing indicator if present
  const typingIndicator = messages.querySelector('.message.typing');
  if (typingIndicator) {
    typingIndicator.remove();
  }

  const node = document.createElement("article");
  node.className = `message ${role}`;

  if (role === "bot") {
    node.innerHTML = `
      ${createMessageAvatar()}
      <div class="message-content formatted-reply">${renderMarkdown(text)}</div>
    `;
  } else {
    node.innerHTML = `
      <div class="message-content">${escapeHtml(text)}</div>
    `;
  }

  messages.appendChild(node);
  scrollToBottom();
}

function showTypingIndicator() {
  const existing = messages.querySelector('.message.typing');
  if (existing) return;

  const node = document.createElement("article");
  node.className = "message bot typing";
  node.innerHTML = `
    ${createMessageAvatar()}
    <div class="message-content">
      <span></span>
      <span></span>
      <span></span>
    </div>
  `;

  messages.appendChild(node);
  scrollToBottom();
}

function removeTypingIndicator() {
  const typing = messages.querySelector('.message.typing');
  if (typing) {
    typing.remove();
  }
}

function scrollToBottom() {
  messages.scrollTo({
    top: messages.scrollHeight,
    behavior: 'smooth'
  });
}

// ── Supplier Contact Card ──────────────────────────────────
function showSupplierContact(supplier) {
  if (!supplier) {
    supplierContact.style.display = "none";
    return;
  }

  const leadTimeText = supplier.lead_time ? `${supplier.lead_time} days` : "Not specified";
  
  supplierContact.innerHTML = `
    <h3>Contact: ${escapeHtml(supplier.name || "")}</h3>
    <p><strong>Email:</strong> <a href="mailto:${escapeHtml(supplier.email || "")}">${escapeHtml(supplier.email || "")}</a></p>
    <p><strong>Phone:</strong> <a href="tel:${escapeHtml(supplier.phone || "")}">${escapeHtml(supplier.phone || "")}</a></p>
    <p><strong>Address:</strong> ${escapeHtml(supplier.address || "")}</p>
    <p><strong>Website:</strong> <a href="https://${escapeHtml(supplier.website || "")}" target="_blank" rel="noopener noreferrer">${escapeHtml(supplier.website || "")}</a></p>
    <p><strong>Lead Time:</strong> ${leadTimeText}</p>
  `;
  supplierContact.style.display = "block";
}

// ── Suggestions ────────────────────────────────────────────
function setSuggestions(items) {
  suggestions.innerHTML = items.map(item => `
    <button type="button" class="suggestion-btn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="16"/>
        <line x1="8" y1="12" x2="16" y2="12"/>
      </svg>
      <span>${escapeHtml(item)}</span>
    </button>
  `).join('');

  // Re-attach event listeners
  suggestions.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const text = button.querySelector('span')?.textContent || button.textContent;
      sendMessage(text);
    });
  });
}

// ── Send Message ───────────────────────────────────────────
async function sendMessage(message) {
  const text = message.trim();
  if (!text) return;

  addMessage(text, "user");
  input.value = "";
  input.disabled = true;
  
  // Disable send button
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  showTypingIndicator();

  try {
    const response = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || "Could not get a response.");
    }

    const data = await response.json();
    
    removeTypingIndicator();
    addMessage(data.reply, "bot");
    setSuggestions(data.suggestions || []);
    showSupplierContact(data.supplier_contact);
    
  } catch (error) {
    console.error("Chat request failed:", error);
    removeTypingIndicator();
    addMessage("Could not connect to the AI service. Please try again later.", "bot");
    showSupplierContact(null);
  } finally {
    input.disabled = false;
    if (submitBtn) submitBtn.disabled = false;
    input.focus();
  }
}

// ── Event Listeners ────────────────────────────────────────
form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

// Handle Enter key
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage(input.value);
  }
});

// Initial suggestion buttons
suggestions.querySelectorAll("button").forEach((button) => {
  button.addEventListener("click", () => {
    const text = button.querySelector('span')?.textContent || button.textContent;
    sendMessage(text);
  });
});

// ── Status Check ───────────────────────────────────────────
async function loadLlmStatus() {
  const statusText = statusBadge.querySelector('.status-text');
  
  try {
    const response = await fetch("/health");
    const data = await response.json();
    
    if (data.llm_enabled) {
      statusBadge.setAttribute('data-status', 'online');
      if (statusText) statusText.textContent = "Online";
    } else {
      statusBadge.setAttribute('data-status', 'offline');
      if (statusText) statusText.textContent = "AI unavailable";
    }
  } catch (error) {
    statusBadge.setAttribute('data-status', 'offline');
    if (statusText) statusText.textContent = "Offline";
  }
}

// Initialize status check
loadLlmStatus();

// Periodic status check every 30 seconds
setInterval(loadLlmStatus, 30000);
