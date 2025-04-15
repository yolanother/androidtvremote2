Refactor TV Remote UI with modern design and modular components

This commit implements a new, modern UI design for the Android TV Remote with the following improvements:

1. Split the monolithic TVRemote component into smaller, modular components:
   - RemoteHeader: Header with TV info and settings button
   - VoiceControls: Voice search and assistant buttons
   - TabNavigation: Tabs for switching between remote, gamepad, and functions
   - PowerHomeButtons: Home and power buttons
   - NavigationButtons: Menu, back, and info buttons
   - DPad: D-pad navigation controls with volume and channel buttons
   - NumberPad: Number pad for direct channel input
   - MediaControls: Media playback controls
   - TVControls: TV-specific controls
   - ColorButtons: Color buttons for TV functions
   - BottomNavigation: Bottom navigation tabs
   - RemoteTab, GamepadTab, FunctionsTab: Tab content components

2. Added responsive design that adapts to different screen sizes
3. Implemented modern UI with glass morphism effects, gradients, and animations
4. Added support for gamepad and function key tabs
5. Improved visual feedback for button presses

The new design provides a more intuitive and visually appealing interface while maintaining all the functionality of the original remote.