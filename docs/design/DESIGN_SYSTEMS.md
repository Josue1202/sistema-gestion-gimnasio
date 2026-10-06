# Catálogo Oficial de Sistemas de Diseño UI/UX - Zona Fitness Pro

Este documento especifica los dos sistemas de diseño aprobados para la plataforma **Zona Fitness Pro**:

1. **Giantucchi NextGen Dark** (Predeterminado - Obsidian & Spectrum)
2. **Supabase Modern Dark** (Alternativa - Graphite & Emerald)

---

## 1. Sistema Giantucchi NextGen Dark

Inspirado en la estética de las aplicaciones core de Giantucchi.

### Tokens de Color y Superficie
```css
:root, [data-theme="giantucchi"] {
  --bg: #050505;                              /* Pitch Space Black */
  --surface: #0a0a0f;                         /* Card Glass Obsidian */
  --surface-2: #101018;                       /* Secondary Container */
  --surface-input: #141420;                   /* Wells e Inputs */
  --surface-hover: #1c1c2e;                   /* Hover */
  --border: rgba(255, 255, 255, 0.08);        /* Hairline Border */
  --border-strong: rgba(255, 255, 255, 0.16); /* Input Borders */
  --border-focus: #06b6d4;                    /* Cian */
  
  --primary: #ffffff;                         /* High-contrast solid white */
  --primary-hover: #f1f5f9;
  --primary-ink: #050505;
  --primary-glow: rgba(255, 255, 255, 0.22);
  
  --spectrum-bar: linear-gradient(90deg, #06b6d4 0%, #3b82f6 20%, #8b5cf6 40%, #ec4899 60%, #f97316 80%, #eab308 100%);
}
```

### Componentes Clave
- **Botón Primario (`.btn.primary`):** Fondo blanco `#ffffff`, texto negro `#050505`, sombra suave.
- **Spectrum Bar:** Franja superior degradada multicolor de 2.5px.
- **Navbar:** Efecto glassmorphic `backdrop-filter: blur(18px)`.

---

## 2. Sistema Supabase Modern Dark

Inspirado en la estética técnica de [supabase.com](https://supabase.com/).

### Tokens de Color y Superficie
```css
[data-theme="supabase"] {
  --bg: #121212;                              /* Dark Graphite */
  --surface: #1c1c1c;                         /* Card Graphite */
  --surface-2: #232323;                       /* Secondary Container */
  --surface-input: #1f1f1f;                   /* Wells e Inputs */
  --surface-hover: #2a2a2a;                   /* Hover */
  --border: #2e2e2e;                          /* Hairline Border */
  --border-strong: #3e3e3e;                   /* Input Borders */
  --border-focus: #3ECF8E;                    /* Supabase Emerald */
  
  --primary: #3ECF8E;                         /* Signature Emerald */
  --primary-hover: #30b77b;
  --primary-ink: #050505;
  --primary-glow: rgba(62, 207, 142, 0.35);
  
  --spectrum-bar: linear-gradient(90deg, #3ECF8E 0%, #30b77b 100%);
}
```

### Componentes Clave
- **Botón Primario (`.btn.primary`):** Fondo esmeralda `#3ECF8E`, texto oscuro `#050505`, resplandor esmeralda `rgba(62, 207, 142, 0.35)`.
- **Badges:** Cápsulas esmeralda `background: rgba(62, 207, 142, 0.12); color: #3ECF8E;`.
- **Focus Rings:** Halo verde esmeralda `0 0 0 3px rgba(62, 207, 142, 0.25)`.

---

## 3. Conmutador Dinámico (Theme Switcher)

Para alternar entre ambos temas en tiempo de ejecución:
```javascript
// Activar tema Supabase
document.documentElement.setAttribute('data-theme', 'supabase');
localStorage.setItem('gym_theme', 'supabase');

// Activar tema Giantucchi
document.documentElement.setAttribute('data-theme', 'giantucchi');
localStorage.setItem('gym_theme', 'giantucchi');
```
