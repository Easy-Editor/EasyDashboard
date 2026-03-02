# EasyDashboard

<div align="center">

English | [简体中文](./README-zh_CN.md)

</div>

EasyDashboard is a data visualization dashboard solution developed based on the [EasyEditor](https://github.com/Easy-Editor/EasyEditor) low-code engine. This project demonstrates how to quickly build professional data visualization applications using EasyEditor's Dashboard plugin and React renderer.

It ships with 20+ pre-built components, AI-powered design generation, multi-page support, and real-time preview — built with React 19, Tailwind CSS v4, and shadcn/ui.

<div align="center">
  <img src=".github/assets/page.png" width='1000' />
</div>

## Features

### Design & Editing

- **Drag-and-Drop Canvas** with multi-page support and configurable resolution (default 1920x1080)
- **Real-Time Property Inspector** with 20+ setter types for fine-grained component configuration
- **Keyboard Shortcuts** for copy, paste, undo/redo, alignment, grouping, layer ordering, and more
- **Smart Guidelines** for automatic alignment and precise positioning
- **Three Editing Modes**: Design Canvas, Code (JSON schema editor), and Preview

### Components & Materials

- **20 Pre-Built Components** across 7 categories:
  - **Basic**: Text
  - **Charts**: Bar, Line, Pie, Gauge, Radar, Scatter
  - **Display**: Carousel, Number Flip, Progress, Scroll List
  - **Media**: Audio, Video, Image, Filter
  - **Interaction**: Button
  - **Maps**: Fly Line, Geo Map
- **On-Demand Remote Loading** — materials are fetched from npm CDN as needed
- **Extensible Material System** — build and register your own components

### Data & Interactivity

- **Multiple Data Sources**: static data, REST API, and global shared data
- **Dynamic Visibility Control** with JavaScript expressions
- **Event Binding** to trigger actions and component methods

### Developer Experience

- **AI Assistant** — describe what you want in natural language, and the AI generates components directly on the canvas
- **Auto-Save** — project schemas are automatically persisted to LocalStorage
- **Dark Mode** with system preference detection
- **Import/Export** project schemas as JSON

## Showcase

- **Component Drag and Drop:** Quickly drag and drop components and data elements onto the design panel for easy layout.

![gif_dnd.gif](.github/assets/gif_dnd.gif)

- **Guidelines:** Automatically displayed guidelines ensure precise component alignment, enhancing design efficiency.

![gif_guideline.gif](.github/assets/gif_guideline.gif)

- **Multiple Pages:** Support for multiple page designs to create complete interactive data dashboards.

![gif_multipage.gif](.github/assets/gif_multipage.gif)

- **Visibility Control:** Implement dynamic visibility control of components for more flexible data presentation.

![gif_js.gif](.github/assets/gif_js.gif)

There are many more features waiting for you to discover and explore.

## Getting Started

### Environment Requirements

- Node.js >= 18.0.0
- pnpm >= 9.12.2

### Local Development

```bash
# Clone the project
git clone https://github.com/Easy-Editor/EasyDashboard

# Navigate to the project directory
cd EasyDashboard

# Install dependencies
pnpm install

# Start the development server
pnpm dev
```

### Available Scripts

```bash
pnpm dev          # Start development server
pnpm build        # Build for production (with type checking)
pnpm build:prod   # Build for production (skip type checking)
pnpm preview      # Preview production build
pnpm lint         # Run code quality checks
pnpm format       # Format code with Biome
pnpm add:ui       # Add shadcn/ui components
```

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests to help improve this project.

## License

[MIT](./LICENSE) License &copy; 2024-PRESENT [JinSo](https://github.com/JinSooo)

## Related Links

This project is developed based on the [EasyEditor](https://github.com/Easy-Editor/EasyEditor) low-code engine, demonstrating how to use EasyEditor to build professional data visualization applications.
