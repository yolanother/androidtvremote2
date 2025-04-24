# Android TV Remote Control

A React component library for controlling Android TVs.

## Installation

### From npm registry (once published)

```bash
# Using npm
npm install android-tv-remote-control

# Using yarn
yarn add android-tv-remote-control

# Using pnpm
pnpm add android-tv-remote-control
```

### Directly from GitHub repository

```bash
# Using npm
npm install git+https://github.com/yourusername/androidtvremote2.git#react/modules/tv-remote-module

# Using yarn
yarn add git+https://github.com/yourusername/androidtvremote2.git#react/modules/tv-remote-module

# Using pnpm
pnpm add git+https://github.com/yourusername/androidtvremote2.git#react/modules/tv-remote-module
```

## Usage

### Basic Usage

```jsx
import { RemoteControl } from 'android-tv-remote-control';
import 'android-tv-remote-control/dist/styles.css';

function App() {
  return (
    <div className="app">
      <RemoteControl 
        ip="192.168.1.100" 
        onCommand={(command) => console.log(`Sending command: ${command}`)}
      />
    </div>
  );
}
```

### With Custom API Integration

```jsx
import { RemoteControl } from 'android-tv-remote-control';
import 'android-tv-remote-control/dist/styles.css';

function App() {
  const handleCommand = async (ip, command) => {
    try {
      const response = await fetch(`/api/tvs/${ip}/control`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ command }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error sending command:', error);
      throw error;
    }
  };

  return (
    <div className="app">
      <RemoteControl 
        ip="192.168.1.100" 
        onCommand={handleCommand}
      />
    </div>
  );
}
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `ip` | string | required | The IP address of the Android TV |
| `onCommand` | function | required | Callback function that receives the IP and command to send to the TV |
| `className` | string | '' | Additional CSS class for styling |
| `showTabs` | boolean | true | Whether to show the tab navigation |
| `initialTab` | string | 'remote' | Initial active tab ('remote', 'gamepad', or 'functions') |

## Development

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/android-tv-remote-control.git
cd android-tv-remote-control

# Install dependencies
npm install

# Build the library
npm run build
```

### Running Tests

```bash
npm test
```

## License

MIT