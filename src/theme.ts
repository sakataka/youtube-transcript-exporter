const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");

function applySystemTheme(prefersDark: boolean) {
  document.documentElement.classList.toggle("dark", prefersDark);
  document.documentElement.style.colorScheme = prefersDark ? "dark" : "light";
}

applySystemTheme(darkModeQuery.matches);
darkModeQuery.addEventListener("change", (event) => applySystemTheme(event.matches));
