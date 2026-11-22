/* Inline shared SVG sprite. Keeps <use href="#..."> working from file://
   where external sprite references are blocked. */
(function () {
  "use strict";
  document.querySelectorAll("[data-include]").forEach(function (slot) {
    var url = slot.getAttribute("data-include");
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, false); // sync: sprite must exist before first paint of icons
    try {
      xhr.send(null);
      if (xhr.status === 200 || (xhr.status === 0 && xhr.responseText)) {
        slot.innerHTML = xhr.responseText;
      }
    } catch (e) {
      /* file:// with no fetch access: icons degrade to empty, layout holds */
    }
  });
})();