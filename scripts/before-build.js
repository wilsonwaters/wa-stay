/**
 * Pre-Build Script
 *
 * This script runs before the build process starts.
 * Use it to verify environment, check dependencies, and prepare build.
 */

const fs = require('fs');
const path = require('path');

exports.default = async function (context) {
  console.log('\n🔧 Running pre-build checks...\n');

  const { electronPlatformName, arch } = context;

  // Log build information
  console.log('📦 Build Information:');
  console.log(`   Platform: ${electronPlatformName}`);
  console.log(`   Architecture: ${arch}`);
  console.log(`   Version: ${context.packager.appInfo.version}`);
  console.log('');

  // Check for required files
  const requiredFiles = ['package.json', 'electron-builder.json'];

  console.log('📋 Checking required files...');
  for (const file of requiredFiles) {
    const filePath = path.join(process.cwd(), file);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ Missing required file: ${file}`);
      process.exit(1);
    } else {
      console.log(`   ✅ ${file}`);
    }
  }
  console.log('');

  // Check for resources
  console.log('🎨 Checking resources...');
  const resourcesDir = path.join(process.cwd(), 'resources');

  if (electronPlatformName === 'darwin') {
    const iconPath = path.join(resourcesDir, 'icons', 'icon.icns');
    if (!fs.existsSync(iconPath)) {
      console.warn(`   ⚠️  Warning: macOS icon not found: ${iconPath}`);
      console.warn('      Build will continue but app may not have an icon');
    } else {
      console.log('   ✅ macOS icon (icon.icns)');
    }
  } else if (electronPlatformName === 'win32') {
    const iconPath = path.join(resourcesDir, 'icons', 'icon.ico');
    if (!fs.existsSync(iconPath)) {
      console.warn(`   ⚠️  Warning: Windows icon not found: ${iconPath}`);
      console.warn('      Build will continue but app may not have an icon');
    } else {
      console.log('   ✅ Windows icon (icon.ico)');
    }
  } else if (electronPlatformName === 'linux') {
    const iconPath = path.join(resourcesDir, 'icons', 'icon.png');
    if (!fs.existsSync(iconPath)) {
      console.warn(`   ⚠️  Warning: Linux icon not found: ${iconPath}`);
      console.warn('      Build will continue but app may not have an icon');
    } else {
      console.log('   ✅ Linux icons');
    }
  }
  console.log('');

  // Check code signing setup
  if (electronPlatformName === 'darwin') {
    console.log('🔐 Checking macOS code signing...');
    if (process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD) {
      console.log('   ✅ Apple credentials configured');
      console.log('   📝 Notarization will be attempted');
    } else {
      console.warn('   ⚠️  Apple credentials not configured');
      console.warn('      Set APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD for notarization');
    }
    console.log('');
  } else if (electronPlatformName === 'win32') {
    console.log('🔐 Checking Windows code signing...');
    if (process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD) {
      console.log('   ✅ Code signing certificate configured');
    } else {
      console.warn('   ⚠️  Code signing certificate not configured');
      console.warn('      Set CSC_LINK and CSC_KEY_PASSWORD for code signing');
    }
    console.log('');
  }

  // Check build output directory
  const outputDir = path.join(process.cwd(), 'release');
  if (!fs.existsSync(outputDir)) {
    console.log('📁 Creating output directory: release/');
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Environment checks
  console.log('🌍 Environment:');
  console.log(`   Node version: ${process.version}`);
  console.log(`   Platform: ${process.platform}`);
  console.log(`   Architecture: ${process.arch}`);
  console.log('');

  console.log('✅ Pre-build checks complete!\n');
};
