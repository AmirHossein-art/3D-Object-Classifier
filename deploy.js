// Node.js script to set up Design Automation App and Activity
// Install required packages: npm install forge-apis adm-zip axios form-data

const { HttpsProxyAgent } = require("https-proxy-agent")
const axios = require('axios').create({ httpsAgent: new HttpsProxyAgent('http://localhost:10809') })

// Force insecure mode and legacy protocols
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
process.env.NODE_OPTIONS = '--tls-min-v1.0 --tls-max-v1.3';

// Force HTTP/1.1 (some proxies have HTTP/2 issues)
process.env.HTTP_VERSION = '1.1';

const ForgeSDK = require('forge-apis');
const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');
const FormData = require('form-data');
const https = require('https');

// Ultra-aggressive HTTPS agent
const aggressiveAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 1000,
    timeout: 60000,
    maxSockets: 1,
    maxFreeSockets: 1,
    scheduling: 'fifo',
    secureProtocol: 'SSLv23_method',
    rejectUnauthorized: false,
    requestCert: false,
    agent: false,
    ciphers: [
        'ECDHE-RSA-AES128-GCM-SHA256',
        'ECDHE-RSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES128-SHA256',
        'ECDHE-RSA-AES128-SHA',
        'ECDHE-RSA-AES256-SHA384',
        'ECDHE-RSA-AES256-SHA',
        'DHE-RSA-AES128-GCM-SHA256',
        'DHE-RSA-AES256-GCM-SHA384',
        'DHE-RSA-AES128-SHA256',
        'DHE-RSA-AES128-SHA',
        'DHE-RSA-AES256-SHA256',
        'DHE-RSA-AES256-SHA',
        'AES128-GCM-SHA256',
        'AES256-GCM-SHA384',
        'AES128-SHA256',
        'AES128-SHA',
        'AES256-SHA256',
        'AES256-SHA',
        'DES-CBC3-SHA'
    ].join(':'),
    honorCipherOrder: true
});

axios.defaults.timeout = 60000;
axios.defaults.maxRedirects = 5;
axios.defaults.validateStatus = () => true;

// Add request interceptor for debugging
axios.interceptors.request.use(request => {
    console.log('🔗 Making request to:', request.url);
    return request;
});

axios.interceptors.response.use(
    response => {
        console.log('✓ Response received:', response.status);
        return response;
    },
    error => {
        console.log('✗ Request failed:', error.code || error.message);
        if (error.config) {
            console.log('Failed URL:', error.config.url);
        }
        return Promise.reject(error);
    }
);

// Alternative authentication function using pure Node.js HTTPS
function authenticateWithNodeHTTPS(clientId, clientSecret) {
    return new Promise((resolve, reject) => {
        const postData = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials',
            scope: 'code:all'
        }).toString();

        const options = {
            hostname: 'developer.api.autodesk.com',
            port: 443,
            path: '/authentication/v1/authenticate',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
                'User-Agent': 'Node.js HTTPS Client'
            },
            secureProtocol: 'SSLv23_method',
            rejectUnauthorized: false,
            requestCert: false,
            agent: false,
            timeout: 60000
        };

        console.log('🔗 Attempting direct HTTPS connection...');

        const req = https.request(options, (res) => {
            console.log('✓ Connection established, status:', res.statusCode);

            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (result.access_token) {
                        console.log('✓ Authentication successful via direct HTTPS');
                        resolve(result.access_token);
                    } else {
                        reject(new Error('No access token in response: ' + data));
                    }
                } catch (parseError) {
                    reject(new Error('Failed to parse response: ' + data));
                }
            });
        });

        req.on('error', (error) => {
            console.log('✗ Direct HTTPS request failed:', error.message);
            reject(error);
        });

        req.on('timeout', () => {
            console.log('✗ Direct HTTPS request timed out');
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.setTimeout(60000);
        req.write(postData);
        req.end();
    });
}

// Configuration - Replace with your values
const CONFIG = {
    client_id: 'fMwA92ClGS2eMfsDfVNGJK21qkBx2mnKVGSTfxdnkYMHMk5y',
    client_secret: 'jtVFjGBaEpxAosU2A3NKagnXIc3Gfq3RUu27EubWVVUGKcWKREHqRv0AlYk5iaen',
    app_name: 'RFAConversionApp',
    app_alias: 'prod',
    activity_name: 'RFAConversionActivity',
    activity_alias: 'prod',
    engine: 'Autodesk.Revit+2025',
    base_url: 'https://developer.api.autodesk.com'
};

class DesignAutomationSetup {
    constructor() {
        this.auth = new ForgeSDK.AuthClientTwoLegged(
            CONFIG.client_id,
            CONFIG.client_secret,
            ['code:all']
        );
        this.accessToken = null;
    }

    async authenticate() {
        console.log('🔑 Trying multiple authentication methods...');

        // Method 1: Direct Node.js HTTPS
        try {
            console.log('Method 1: Direct Node.js HTTPS...');
            this.accessToken = await authenticateWithNodeHTTPS(CONFIG.client_id, CONFIG.client_secret);
            return true;
        } catch (error) {
            console.log('Method 1 failed:', error.message);
        }

        // Method 2: Axios with aggressive settings
        try {
            console.log('Method 2: Axios with aggressive TLS...');
            const response = await axios.post(
                'https://developer.api.autodesk.com/authentication/v2/token',
                new URLSearchParams({
                    client_id: CONFIG.client_id,
                    client_secret: CONFIG.client_secret,
                    grant_type: 'client_credentials',
                    scope: 'code:all'
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    httpsAgent: new HttpsProxyAgent('http://localhost:10809'),
                    timeout: 60000,
                }
            );

            if (response.data && response.data.access_token) {
                this.accessToken = response.data.access_token;
                console.log('✓ Authentication successful via Axios');
                return true;
            }
        } catch (error) {
            console.log('Method 2 failed:', error.message);
        }

        // Method 3: Original Forge SDK (last resort)
        try {
            console.log('Method 3: Original Forge SDK...');
            const token = await this.auth.authenticate();
            this.accessToken = token.access_token;
            console.log('✓ Authentication successful via Forge SDK');
            return true;
        } catch (error) {
            console.log('Method 3 failed:', error.message);
        }

        console.error('✗ All authentication methods failed');
        return false;
    }

    async makeRequest(method, endpoint, data = null) {
        const config = {
            method,
            url: `${CONFIG.base_url}${endpoint}`,
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            }
        };

        if (data) {
            config.data = data;
        }

        try {
            const response = await axios(config);

            // Check for HTTP error status codes
            if (response.status >= 400) {
                throw new Error(`HTTP ${response.status}: ${JSON.stringify(response.data)}`);
            }

            return { success: true, data: response.data, status: response.status };
        } catch (error) {
            if (error.response) {
                return {
                    success: false,
                    error: `API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`,
                    status: error.response.status,
                    data: error.response.data
                };
            }
            return { success: false, error: error.message };
        }
    }

    async uploadFile(uploadUrl, formData, buffer, filename) {
        const form = new FormData();

        // Add form fields from uploadUrl parameters
        Object.keys(formData).forEach(key => {
            form.append(key, formData[key]);
        });

        // Add the file
        form.append('file', buffer, filename);

        try {
            const response = await axios.post(uploadUrl, form, {
                headers: form.getHeaders(),
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });

            if (response.status >= 400) {
                throw new Error(`Upload failed: ${response.status} - ${response.statusText}`);
            }

            return true;
        } catch (error) {
            console.error('Upload error details:', error.response?.data || error.message);
            throw error;
        }
    }

    async createAppBundle() {
        try {
            console.log('📦 Creating app bundle...');

            // Check for required files
            const dllPath = './RFAConversion/bin/Release/net48/RFAConversion.dll';
            const packagePath = './PackageContents.xml';

            console.log('Checking for required files...');
            console.log('DLL path:', dllPath, '- exists:', fs.existsSync(dllPath));
            console.log('Package path:', packagePath, '- exists:', fs.existsSync(packagePath));

            if (!fs.existsSync(dllPath)) {
                throw new Error(`DLL not found at: ${dllPath}`);
            }
            if (!fs.existsSync(packagePath)) {
                throw new Error(`PackageContents.xml not found at: ${packagePath}`);
            }

            // Create ZIP bundle
            const zip = new AdmZip();
            zip.addLocalFile(dllPath);
            zip.addLocalFile(packagePath);
            const bundleBuffer = zip.toBuffer();
            console.log('Bundle size:', bundleBuffer.length, 'bytes');

            // Create the app bundle
            const appBundle = {
                id: CONFIG.app_name,
                engine: CONFIG.engine,
                description: 'RFA to RVT conversion tool'
            };

            console.log('Creating app bundle with data:', JSON.stringify(appBundle, null, 2));

            const result = await this.makeRequest('POST', '/da/us-east/v3/appbundles', appBundle);

            if (!result.success) {
                console.error('✗ App bundle creation failed:', result.error);
                return false;
            }

            console.log('App bundle creation result:', JSON.stringify(result.data, null, 2));

            // Upload the bundle if upload parameters are provided
            if (result.data.uploadParameters) {
                console.log('Uploading bundle...');
                console.log('Upload URL:', result.data.uploadParameters.endpointURL);
                console.log('Form data keys:', Object.keys(result.data.uploadParameters.formData || {}));

                await this.uploadFile(
                    result.data.uploadParameters.endpointURL,
                    result.data.uploadParameters.formData,
                    bundleBuffer,
                    'bundle.zip'
                );
                console.log('✓ App bundle uploaded');
            } else {
                console.log('No upload parameters provided in response');
            }

            // Create alias
            const alias = {
                id: CONFIG.app_alias,
                version: 1
            };

            console.log('Creating alias with data:', JSON.stringify(alias, null, 2));
            const aliasResult = await this.makeRequest('POST', `/da/us-east/v3/appbundles/${CONFIG.app_name}/aliases`, alias);

            if (!aliasResult.success) {
                console.error('✗ App bundle alias creation failed:', aliasResult.error);
                return false;
            }

            console.log('Alias creation result:', JSON.stringify(aliasResult.data, null, 2));
            console.log('✓ App bundle alias created');

            return true;

        } catch (error) {
            console.error('✗ App bundle creation failed:', error.message);
            return false;
        }
    }

    async createActivity() {
        try {
            console.log('⚙️ Creating activity...');

            // Fixed activity definition - using proper qualified name format
            const activity = {
                id: CONFIG.activity_name,
                appbundles: [`3DImgClass.${CONFIG.app_name}+${CONFIG.app_alias}`], // Use the full qualified name
                commandLine: [
                    `$(engine.path)\\revit.exe`,
                    `/i "$(args[inputFile].path)"`,
                    `/al "$(appbundles[3DImgClass.${CONFIG.app_name}].path)"` // Updated reference
                ],
                engine: CONFIG.engine,
                parameters: {
                    inputFile: {
                        verb: 'get',
                        description: 'Input ZIP file containing RFA families',
                        required: true,
                        localName: 'families.zip'
                    },
                    outputFile: {
                        verb: 'put',
                        description: 'Output RVT file',
                        required: true,
                        localName: 'result.rvt'
                    }
                }
            };

            console.log('Creating activity with data:', JSON.stringify(activity, null, 2));

            const result = await this.makeRequest('POST', '/da/us-east/v3/activities', activity);

            if (!result.success) {
                console.error('✗ Activity creation failed:', result.error);
                return false;
            }

            console.log('Activity creation result:', JSON.stringify(result.data, null, 2));
            console.log('✓ Activity created');

            // Create alias
            const alias = {
                id: CONFIG.activity_alias,
                version: 1
            };

            console.log('Creating activity alias with data:', JSON.stringify(alias, null, 2));
            const aliasResult = await this.makeRequest('POST', `/da/us-east/v3/activities/${CONFIG.activity_name}/aliases`, alias);

            if (!aliasResult.success) {
                console.error('✗ Activity alias creation failed:', aliasResult.error);
                return false;
            }

            console.log('Activity alias creation result:', JSON.stringify(aliasResult.data, null, 2));
            console.log('✓ Activity alias created');

            return true;

        } catch (error) {
            console.error('✗ Activity creation failed:', error.message);
            return false;
        }
    }

    async executeWorkItem(inputFileUrl, outputFileUrl) {
        try {
            console.log('🚀 Executing work item...');

            const workItem = {
                activityId: `${CONFIG.activity_name}+${CONFIG.activity_alias}`,
                arguments: {
                    inputFile: {
                        url: inputFileUrl
                    },
                    outputFile: {
                        url: outputFileUrl,
                        verb: 'put'
                    }
                }
            };

            console.log('Creating work item with data:', JSON.stringify(workItem, null, 2));

            const workItemResult = await this.makeRequest('POST', '/da/us-east/v3/workitems', workItem);

            if (!workItemResult.success) {
                console.error('✗ Work item creation failed:', workItemResult.error);
                return { success: false, error: workItemResult.error };
            }

            console.log('✓ Work item created:', workItemResult.data.id);

            // Poll for completion
            let status = 'pending';
            let attempts = 0;
            const maxAttempts = 60; // 5 minutes max

            while ((status === 'pending' || status === 'inprogress') && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                const statusResult = await this.makeRequest('GET', `/da/us-east/v3/workitems/${workItemResult.data.id}`);

                if (statusResult.success) {
                    status = statusResult.data.status;
                    console.log(`Status: ${status} (attempt ${++attempts})`);

                    if (status === 'failedLimitProcessingTime' || status === 'failedLimitDataSize' ||
                        status === 'failedDownload' || status === 'failedInstructions' || status === 'failedUpload') {
                        break;
                    }
                } else {
                    console.error('Failed to get work item status:', statusResult.error);
                    break;
                }
            }

            if (status === 'success') {
                console.log('✓ Work item completed successfully');
                return { success: true, workItemId: workItemResult.data.id };
            } else {
                console.log('✗ Work item failed with status:', status);
                const details = await this.makeRequest('GET', `/da/us-east/v3/workitems/${workItemResult.data.id}`);
                console.log('Error details:', JSON.stringify(details.data, null, 2));
                return { success: false, details: details.data };
            }

        } catch (error) {
            console.error('✗ Work item execution failed:', error.message);
            return { success: false, error: error.message };
        }
    }
async listExistingResources() {
        try {
            console.log('📋 Listing existing resources...');

            // List app bundles
            try {
                const appBundles = await this.makeRequest('GET', '/da/us-east/v3/appbundles');
                console.log('Raw app bundles response:', JSON.stringify(appBundles, null, 2));

                if (appBundles && Array.isArray(appBundles.data)) {
                    const bundleIds = appBundles.data.map(ab => ab.id || 'Unknown ID');
                    console.log('Existing app bundles:', bundleIds);

                    // Check if our specific bundle exists
                    const ourBundle = appBundles.data.find(ab => ab.id === CONFIG.app_name);
                    if (ourBundle) {
                        console.log('✓ Our app bundle exists:', ourBundle.id);
                    } else {
                        console.log('✗ Our app bundle not found:', CONFIG.app_name);
                    }
                } else {
                    console.log('App bundles response format unexpected:', typeof appBundles);
                }
            } catch (error) {
                console.log('Could not list app bundles:', error.message);
            }

            // List activities
            try {
                const activities = await this.makeRequest('GET', '/da/us-east/v3/activities');
                console.log('Raw activities response:', JSON.stringify(activities, null, 2));

                if (activities && Array.isArray(activities.data)) {
                    const activityIds = activities.data.map(act => act.id || 'Unknown ID');
                    console.log('Existing activities:', activityIds);

                    // Check if our specific activity exists
                    const ourActivity = activities.data.find(act => act.id === CONFIG.activity_name);
                    if (ourActivity) {
                        console.log('✓ Our activity exists:', ourActivity.id);
                    } else {
                        console.log('✗ Our activity not found:', CONFIG.activity_name);
                    }
                } else {
                    console.log('Activities response format unexpected:', typeof activities);
                }
            } catch (error) {
                console.log('Could not list activities:', error.message);
            }

        } catch (error) {
            console.error('Error listing resources:', error.message);
        }
    }
    async deleteExistingResources() {
        try {
            console.log('🗑️ Cleaning up existing resources...');

            // Delete activity alias
            try {
                const result = await this.makeRequest('DELETE', `/da/us-east/v3/activities/${CONFIG.activity_name}/aliases/${CONFIG.activity_alias}`);
                if (result.success || result.status === 404) {
                    console.log('✓ Activity alias deleted');
                } else {
                    console.log('Activity alias deletion failed:', result.error);
                }
            } catch (error) {
                console.log('Activity alias not found or already deleted');
            }

            // Delete activity
            try {
                const result = await this.makeRequest('DELETE', `/da/us-east/v3/activities/${CONFIG.activity_name}`);
                if (result.success || result.status === 404) {
                    console.log('✓ Activity deleted');
                } else {
                    console.log('Activity deletion failed:', result.error);
                }
            } catch (error) {
                console.log('Activity not found or already deleted');
            }

            // Delete app bundle alias
            try {
                const result = await this.makeRequest('DELETE', `/da/us-east/v3/appbundles/${CONFIG.app_name}/aliases/${CONFIG.app_alias}`);
                if (result.success || result.status === 204 || result.status === 404) {
                    console.log('✓ App bundle alias deleted');
                } else {
                    console.log('App bundle alias deletion failed:', result.error);
                }
            } catch (error) {
                console.log('App bundle alias not found or already deleted');
            }

            // Delete app bundle
            try {
                const result = await this.makeRequest('DELETE', `/da/us-east/v3/appbundles/${CONFIG.app_name}`);
                if (result.success || result.status === 204 || result.status === 404) {
                    console.log('✓ App bundle deleted');
                } else {
                    console.log('App bundle deletion failed:', result.error);
                }
            } catch (error) {
                console.log('App bundle not found or already deleted');
            }

        } catch (error) {
            console.error('Error during cleanup:', error.message);
        }
    }

    async setup() {
        console.log('🔧 Setting up Design Automation...');

        if (!await this.authenticate()) {
            console.error('❌ Setup failed: Authentication failed');
            return false;
        }

        // Clean up existing resources first
        await this.deleteExistingResources();

        if (!await this.createAppBundle()) {
            console.error('❌ Setup failed: App bundle creation failed');
            return false;
        }

        if (!await this.createActivity()) {
            console.error('❌ Setup failed: Activity creation failed');
            return false;
        }

        console.log('✅ Setup complete!');
        return true;
    }
}

// Usage example
async function main() {
    try {
        const setup = new DesignAutomationSetup();

        const command = process.argv[2];

        switch (command) {
            case 'setup':
                const success = await setup.setup();
                if (!success) {
                    console.error('❌ Setup failed!');
                    process.exit(1);
                }
                break;

            case 'execute':
                if (!process.argv[3] || !process.argv[4]) {
                    console.log('Usage: node deploy.js execute <input-url> <output-url>');
                    process.exit(1);
                }
                await setup.authenticate();
                const result = await setup.executeWorkItem(process.argv[3], process.argv[4]);
                console.log('Execution result:', result);
                break;

            case 'list':
                await setup.authenticate();
                await setup.listExistingResources();
                break;

            case 'cleanup':
                await setup.authenticate();
                await setup.deleteExistingResources();
                break;

            default:
                console.log('Usage:');
                console.log('  node deploy.js setup                    - Set up app bundle and activity');
                console.log('  node deploy.js execute <input> <output> - Execute work item');
                console.log('  node deploy.js list                     - List existing resources');
                console.log('  node deploy.js cleanup                  - Delete existing resources');
                break;
        }
    } catch (error) {
        console.error('Operation failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = DesignAutomationSetup;