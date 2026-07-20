for (const select of document.querySelectorAll(".mobile-instrument-select")) {
  select.addEventListener("change", () => {
    if (select.value) globalThis.location.href = select.value;
  });
}
