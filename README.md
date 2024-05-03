# instagram.js

The Most Powerful Library Of Instagram To Create A Bot Like Discord.js.

## Installation
 `$ npm install @cycloneaddons/instagram.js` 

## Setup

```js
const Instagram = require("@cycloneaddons/instagram.js");
const client = new Instagram.Client();

client.on("ready", () => {
  console.log(`Logged in as ${client.user.fullName}`);
});

client.on("messageCreate", (message) => {
  if (message.author.id === client.user.id) return;

  message.seen();

  if (message.content === "!ping") {
  
  message.send("!pong") 
  // message.chat.send("!pong");
  }

  message.chat.startTyping();
});

client.login("username", "password");
```
