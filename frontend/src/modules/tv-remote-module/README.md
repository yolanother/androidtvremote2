# Android TV Remote Control

A React component library for controlling Android TVs.

## Installation

You can install this package using npm:

```bash
npm install android-tv-remote-control
```

Or directly from the git repository:

```bash
npm install git+https://github.com/yourusername/androidtvremote2.git#frontend/modules/tv-remote-module
```

## Usage

```jsx
import React from 'react';
import { RemoteControl } from 'android-tv-remote-control';

const MyTVRemote = () => {
  const handleCommand = (ip, command) => {
    // Send the command to your Android TV
    console.log(`Sending command ${command} to TV at ${ip}`);
    
    // Implement your API call here
    return fetch(`http://your-api.com/tv/${ip}/command/${command}`)
      .then(response => response.json());
  };

  return (
    <RemoteControl 
      ip="192.168.1.100" 
      tvName="Living Room TV"
      onCommand={handleCommand}
    />
  );
};

export default MyTVRemote;
```

## Props

The `RemoteControl` component accepts the following props:

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `ip` | string | required | The IP address of the Android TV |
| `tvName` | string | "Android TV" | The name of the TV to display in the header |
| `onCommand` | function | required | Function to call when a button is pressed. Receives `(ip, command)` as arguments |
| `className` | string | "" | Additional CSS class to apply to the remote container |
| `showTabs` | boolean | true | Whether to show the tab navigation |
| `initialTab` | string | "remote" | The initial active tab ("remote", "gamepad", "functions") |

## Development

To build the package:

```bash
npm run build
```

To run tests:

```bash
npm test
```

## License

MIT