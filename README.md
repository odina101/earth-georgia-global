# Stripe Globe

A 3D Earth globe component with a Stripe-style dotted visualization, TopoJSON-based continent shapes, and animated arcs. Built with React and Three.js.

## As a full app

```bash
# Install
pnpm install

# Dev
pnpm dev

# Build and run production
pnpm build && pnpm start
```

## Install as a package (from GitHub)

Install directly from this repo:

```bash
# npm
npm install github:odina101/earth-georgia-global

# pnpm
pnpm add github:odina101/earth-georgia-global

# yarn
yarn add github:odina101/earth-georgia-global
```

Use the Globe in your React app (your bundler will compile the component):

```tsx
import { Globe } from 'stripe-globe';

function App() {
  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <Globe />
    </div>
  );
}
```

**Peer dependencies:** ensure your project has `react`, `react-dom`, and `three` installed.

## Publish to npm (optional)

To publish so others can `npm install stripe-globe`:

1. Build the library: `pnpm run build:lib`
2. Log in: `npm login`
3. Publish: `npm publish`

## Upload this repo to GitHub

**Push to GitHub** (repo: [odina101/earth-georgia-global](https://github.com/odina101/earth-georgia-global)):

```bash
git add .
git commit -m "Initial commit: Stripe-style 3D globe"
git branch -M main
git remote add origin git@github.com:odina101/earth-georgia-global.git
git push -u origin main
```

## License

MIT
