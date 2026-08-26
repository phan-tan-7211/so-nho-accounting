import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages serves this repository as a project site under
// https://phan-tan-7211.github.io/so-nho-accounting/
export default defineConfig({
  base: '/so-nho-accounting/',
  plugins: [react()],
})
