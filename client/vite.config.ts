import react from '@vitejs/plugin-react';
export default {plugins:[react()],test:{environment:'jsdom',setupFiles:'./src/testSetup.ts'}};
