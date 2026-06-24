#!/bin/bash
exec npx next start --port 3001 --dir /Users/marcello/Desktop/Holistic\ Unity/client-webapp 2>/dev/null || \
  ( cd /Users/marcello/Desktop/Holistic\ Unity/client-webapp && exec npx next start --port 3001 )
