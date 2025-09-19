# RankGun Relay Server

This is a simple relay server for Roblox RankGun.  
It allows in-game scripts to promote/demote users using Open Cloud securely, without exposing the API key to clients.

## Setup

1. Clone this repo or download the ZIP.
2. Run `npm install` to install dependencies.
3. Set your Open Cloud key in an environment variable:
   ```bash
   export OPEN_CLOUD_KEY=your_key_here
   ```
4. Start the server:
   ```bash
   npm start
   ```

The relay will listen on port 3000 by default.

## Usage

POST `/promote` with JSON body:
```json
{
  "groupId": 3520194,
  "userId": 123456789,
  "roleId": 24198018
}
```

Response example:
```json
{ "ok": true, "where": "groupsV1", "status": 200 }
```

