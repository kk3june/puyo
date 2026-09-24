import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser', fullyParallel:false,
  use:{baseURL:'http://localhost:3217', headless:true, channel:'chrome'},
  webServer:{command:'node node_modules/next/dist/bin/next dev -p 3217',url:'http://localhost:3217',reuseExistingServer:false,env:{NEXT_PUBLIC_GA_MEASUREMENT_ID:'G-TEST12345'}},
});
