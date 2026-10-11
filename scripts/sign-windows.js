/**
 * Windows Code Signing Script
 *
 * This script handles code signing for Windows builds.
 * Code signing is recommended for Windows to avoid SmartScreen warnings.
 *
 * Prerequisites:
 * - Code signing certificate (PFX/P12 file)
 * - Windows SDK installed (for signtool.exe)
 *
 * Environment Variables Required:
 * - CSC_LINK: Path to certificate file or base64-encoded certificate
 * - CSC_KEY_PASSWORD: Certificate password
 */

const { execSync } = require('child_process');
const fs = require('fs');

exports.default = async function (configuration) {
  // Check if we have a certificate configured
  if (!process.env.CSC_LINK || !process.env.CSC_KEY_PASSWORD) {
    console.log('⚠️  Skipping Windows code signing - certificate not configured');
    console.log('Set CSC_LINK and CSC_KEY_PASSWORD to enable code signing');
    return;
  }

  const file = configuration.path;

  console.log(`\n🔐 Signing Windows executable: ${file}`);

  // Detect signtool.exe location
  const signtoolPaths = [
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.22621.0\\x64\\signtool.exe',
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\x64\\signtool.exe',
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.19041.0\\x64\\signtool.exe',
    // Add more possible paths
  ];

  let signtoolPath = 'signtool'; // Default to PATH

  for (const testPath of signtoolPaths) {
    if (fs.existsSync(testPath)) {
      signtoolPath = `"${testPath}"`;
      break;
    }
  }

  // Timestamp servers (try multiple in case one is down)
  const timestampServers = [
    'http://timestamp.digicert.com',
    'http://timestamp.comodoca.com',
    'http://timestamp.globalsign.com',
  ];

  let signed = false;
  let lastError = null;

  for (const timestampServer of timestampServers) {
    try {
      console.log(`Attempting to sign with timestamp server: ${timestampServer}`);

      const command = `${signtoolPath} sign /f "${process.env.CSC_LINK}" /p "${process.env.CSC_KEY_PASSWORD}" /tr ${timestampServer} /td sha256 /fd sha256 "${file}"`;

      execSync(command, {
        stdio: 'inherit',
        windowsHide: true,
      });

      console.log(`✅ Successfully signed: ${file}\n`);
      signed = true;
      break;
    } catch (error) {
      console.log(`Failed with ${timestampServer}, trying next...`);
      lastError = error;
    }
  }

  if (!signed) {
    console.error('❌ Failed to sign executable with all timestamp servers');
    console.error('\nTroubleshooting:');
    console.error('1. Verify certificate path and password are correct');
    console.error('2. Check that Windows SDK is installed');
    console.error('3. Ensure certificate is valid and not expired');
    console.error('4. Try signing manually:\n');
    console.error(`   signtool sign /f "certificate.pfx" /p "password" "${file}"\n`);
    throw lastError || new Error('Code signing failed');
  }

  // Verify the signature
  try {
    execSync(`${signtoolPath} verify /pa "${file}"`, {
      stdio: 'inherit',
      windowsHide: true,
    });
    console.log('✅ Signature verification passed\n');
  } catch {
    console.error('⚠️  Warning: Signature verification failed');
  }
};
