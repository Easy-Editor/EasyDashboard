# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EasyDashboard is a data visualization dashboard builder developed on top of the EasyEditor low-code engine. It serves as a reference application demonstrating how to build production applications using published `@easy-editor/*` packages.

## Build & Development Commands

```bash
# Install dependencies (pnpm 9.12.2+, node >= 18.0.0)
pnpm install

# Start development server (Vite)
pnpm dev

# Build for production
pnpm build

# Build for production (skip type checking)
pnpm build:prod

# Preview production build
pnpm preview

# Format code (Biome)
pnpm format

# Lint code (Biome)
pnpm lint

# Add shadcn/ui component
pnpm add:ui
```

## High-Level Architecture

### Application Type

This is a **single-page application (SPA)** built with:
- React 19 + Vite
- React Router for routing (`/` editor, `/preview` preview mode)
- Tailwind CSS v4 + shadcn/ui for UI components
- Monaco Editor for code editing

### Key Dependencies

**EasyEditor Core Packages** (consumed from npm):
- `@easy-editor/core` - Core engine
- `@easy-editor/plugin-dashboard` - Dashboard features
- `@easy-editor/plugin-datasource` - Data source management
- `@easy-editor/plugin-hotkey` - Keyboard shortcuts
- `@easy-editor/renderer-core` - Base renderer
- `@easy-editor/react-renderer` - React renderer
- `@easy-editor/react-renderer-dashboard` - Dashboard-specific React renderer

**UI Libraries**:
- `@radix-ui/*` - Accessible UI primitives
- `lucide-react` - Icons
- `recharts` - Chart library
- `@monaco-editor/react` - Code editor

**State Management**:
- `mobx-react` - For observing EasyEditor's MobX state

### Project Structure

```
src/
├── editor/                 # EasyEditor configuration
│   ├── index.ts           # Engine initialization
│   ├── const.ts           # Default project schema
│   ├── materials/         # Material registration
│   ├── plugins/           # Custom plugins
│   ├── setters/           # Setter registration
│   └── overrides.css      # Engine style overrides
│
├── pages/
│   ├── editor/            # Main editor page
│   └── preview/           # Preview mode page
│
├── components/            # Reusable UI components
│   ├── ui/               # shadcn/ui components
│   └── theme-provider.tsx # Dark mode support
│
├── lib/                   # Utilities
│   ├── schema.ts         # LocalStorage schema management
│   └── utils.ts          # Helper functions
│
├── hooks/                 # Custom React hooks
├── styles/                # Global styles
└── App.tsx               # App entry + routing
```

### Editor Initialization Flow

**Entry point**: `src/main.tsx` imports `src/editor/index.ts` before rendering React:

1. **Plugin Registration** (`src/editor/index.ts:13-27`)
   - Register `DashboardPlugin` with Group component configuration
   - Register `HotkeyPlugin`, `DataSourcePlugin`
   - Register custom plugins from `src/editor/plugins/`

2. **Material Registration** (`src/editor/index.ts:28`)
   - Build component metadata map from `src/editor/materials/componentMetaMap`
   - Materials are imported from the EasyEditor ecosystem

3. **Setter Registration** (`src/editor/index.ts:29`)
   - Register all setters from `src/editor/setters/setterMap`
   - Setters control property configuration UI

4. **Engine Initialization** (`src/editor/index.ts:31-38`)
   - Call `init()` with design mode and app helpers
   - Configure simulator viewport (1920x1080)

5. **Project Loading** (`src/editor/index.ts:44-54`)
   - Load project schema from localStorage if exists
   - Otherwise use `defaultProjectSchema` from `src/editor/const.ts`

### Material System Integration

Materials are registered in `src/editor/materials/`:
- Each material exports metadata conforming to EasyEditor's material spec
- Materials can be from `@easy-editor/materials-*` packages or custom implementations
- `componentMetaMap` aggregates all materials for registration

### Setter System Integration

Setters are registered in `src/editor/setters/`:
- Imports setters from `@easy-editor/setters` or custom implementations
- `setterMap` maps setter names to setter components
- Setters appear in the property configuration panel

### Custom Plugins

Custom plugins in `src/editor/plugins/` extend editor functionality:
- Follow EasyEditor's plugin API
- Register via `plugins.registerPlugins()`
- Can access core services via dependency injection

## Vite Configuration

Key settings in `vite.config.mts`:

- **React Plugin**: Babel configured with decorators support (for MobX)
- **Tailwind Plugin**: `@tailwindcss/vite` for v4 support
- **Path Alias**: `@/` maps to `./src`
- **Build Target**: `esnext` for modern browsers

## TypeScript Configuration

Uses TypeScript project references:
- `tsconfig.json` - Root configuration with path aliases (`@/*`)
- `tsconfig.app.json` - App source code settings
- `tsconfig.node.json` - Vite config and Node scripts

Path alias `@/*` maps to `./src/*` for cleaner imports.

## Code Standards

Uses **Biome** for formatting and linting:

### Key Rules
- **Type Safety**: Explicit types, avoid `any`
- **Modern React**: Function components, hooks, proper dependencies
- **Async/Await**: Prefer over promise chains
- **Security**: `rel="noopener"` for external links
- **No Debug Code**: Remove `console.log`, `debugger`, `alert`

### Formatting
- Single quotes
- 2-space indent
- 120 line width
- Semicolons required

Run `pnpm format` before committing.

## Styling Approach

Uses **Tailwind CSS v4** with modern syntax:

```css
/* src/styles/index.css */
@import "tailwindcss";
@plugin "tailwindcss-animate";
@custom-variant dark (&:is(.dark *));
```

**shadcn/ui Integration**:
- Components in `src/components/ui/`
- CSS variables for theming (light/dark mode)
- Use `pnpm add:ui` to add new components

**Theme System**:
- `ThemeProvider` wraps the app for dark mode support
- Theme stored in localStorage (`easy-dashboard-theme`)
- Supports system preference detection

## Data Persistence

**LocalStorage Usage**:
- Project schema saved to `localStorage` on changes
- Retrieved on app load via `getProjectSchemaFromLocalStorage()`
- Located in `src/lib/schema.ts`

## Routing

Uses React Router 7:
- `/` - Main editor page
- `/preview` - Preview mode (renders dashboard without editor UI)
- Lazy-loaded routes with `<Suspense>`
- Error boundary for crash protection

## Working with the Codebase

### Adding a New Material

1. Import material metadata in `src/editor/materials/`
2. Add to `componentMetaMap` object
3. Material will be available in the materials panel

### Adding a New Setter

1. Import setter component in `src/editor/setters/`
2. Add to `setterMap` object
3. Reference setter name in material `configure.ts`

### Adding a Custom Plugin

1. Create plugin file in `src/editor/plugins/`
2. Implement plugin following EasyEditor's Plugin class
3. Add to `pluginList` array
4. Plugin will be registered on engine init

### Modifying Default Project Schema

1. Edit `defaultProjectSchema` in `src/editor/const.ts`
2. Schema follows EasyEditor's project schema format
3. Clear localStorage to see changes (or delete saved projects)

### Adding shadcn/ui Components

```bash
pnpm add:ui button    # Add Button component
pnpm add:ui dialog    # Add Dialog component
```

Components will be added to `src/components/ui/`

### Customizing Editor Styles

Edit `src/editor/overrides.css` to override EasyEditor's default styles.

## Important Constraints

1. **Use Published Packages**: Always use `@easy-editor/*` packages from npm, not workspace references
2. **Don't Modify Engine Code**: This is a consumer application - engine changes belong in EasyEditor repo
3. **Materials Belong Elsewhere**: New materials should be added to EasyMaterials repo
4. **Setters Belong Elsewhere**: New setters should be added to EasySetters repo

## Common Pitfalls

- **Forgetting to register**: Materials/setters must be registered in `src/editor/index.ts`
- **Decorator support**: Ensure Babel decorators plugin is enabled for MobX (already configured)
- **Theme variables**: Use CSS variables from Tailwind config, not hardcoded colors
- **LocalStorage persistence**: Clear localStorage when testing schema changes
- **Async initialization**: `src/editor/index.ts` uses top-level await - ensure it runs before React renders

## Package Manager

**Must use pnpm 9.12.2+** - enforced by `preinstall` script. Other package managers will fail.

## Browser Support

Builds target **modern browsers** (`esnext`):
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

No IE11 support.
