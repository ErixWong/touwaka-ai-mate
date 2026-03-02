#!/usr/bin/env node
/**
 * Convert PPT extracted content to Wiki.js pages
 * 
 * Usage:
 *   node ppt_to_wiki.js \
 *     --content tmp/ppt_extracted/content.md \
 *     --images tmp/ppt_extracted/slides_png_hd2 \
 *     --output-path "ppt/presentation-name" \
 *     --title "Presentation Title"
 * 
 * Or with asset upload:
 *   node ppt_to_wiki.js \
 *     --content tmp/ppt_extracted/content.md \
 *     --images tmp/ppt_extracted/slides_png_hd2 \
 *     --output-path "ppt/presentation-name" \
 *     --title "Presentation Title" \
 *     --upload-to-folder 1
 */

const fs = require('fs');
const path = require('path');
const WikiJSClient = require('./wikijs_client');

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        content: null,
        images: null,
        outputPath: null,
        title: null,
        locale: 'en',
        tags: 'ppt,presentation',
        uploadToFolder: null,
        embedImages: false
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--content':
            case '-c':
                options.content = args[++i];
                break;
            case '--images':
            case '-i':
                options.images = args[++i];
                break;
            case '--output-path':
            case '-o':
                options.outputPath = args[++i];
                break;
            case '--title':
            case '-t':
                options.title = args[++i];
                break;
            case '--locale':
            case '-l':
                options.locale = args[++i];
                break;
            case '--tags':
                options.tags = args[++i];
                break;
            case '--upload-to-folder':
            case '-u':
                options.uploadToFolder = parseInt(args[++i]);
                break;
            case '--embed-images':
            case '-e':
                options.embedImages = true;
                break;
        }
    }

    return options;
}

function imageToBase64(imagePath) {
    const data = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml'
    };
    const mime = mimeTypes[ext] || 'image/png';
    return `data:${mime};base64,${data.toString('base64')}`;
}

async function uploadImages(client, imagesDir, folderId) {
    const imageFiles = fs.readdirSync(imagesDir)
        .filter(f => /\.(png|jpg|jpeg|gif|svg)$/i.test(f))
        .sort();

    console.log(`Found ${imageFiles.length} images to upload...\n`);

    const results = [];
    for (let i = 0; i < imageFiles.length; i++) {
        const filename = imageFiles[i];
        const filePath = path.join(imagesDir, filename);
        
        process.stdout.write(`[${i + 1}/${imageFiles.length}] Uploading ${filename}... `);
        
        try {
            const result = await client.uploadFile(filePath, filename, folderId);
            if (result.succeeded || result === 'ok') {
                console.log('OK');
                results.push({ success: true, filename });
            } else {
                console.log(`Failed: ${result.message || result}`);
                results.push({ success: false, filename, error: result.message });
            }
        } catch (err) {
            console.log(`Error: ${err.message}`);
            results.push({ success: false, filename, error: err.message });
        }
        
        // Small delay to not overwhelm the server
        await new Promise(r => setTimeout(r, 300));
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`\nUpload complete: ${successCount}/${results.length} successful`);
    
    return results;
}

function createImagesSection(imagesDir, options, uploadedImages = []) {
    if (!imagesDir || !fs.existsSync(imagesDir)) {
        return '';
    }

    const imageFiles = fs.readdirSync(imagesDir)
        .filter(f => /\.(png|jpg|jpeg|gif|svg)$/i.test(f))
        .sort();

    if (imageFiles.length === 0) {
        return '';
    }

    let section = `## 📊 PPT幻灯片预览\n\n> 共 ${imageFiles.length} 页\n\n`;

    for (let i = 0; i < imageFiles.length; i++) {
        const imgFile = imageFiles[i];
        section += `### 幻灯片 ${i + 1}\n\n`;

        if (options.embedImages) {
            // Embed as base64
            const imgPath = path.join(imagesDir, imgFile);
            try {
                const dataUri = imageToBase64(imgPath);
                section += `![Slide ${i + 1}](${dataUri})\n\n`;
            } catch (err) {
                section += `(Error loading image: ${err.message})\n\n`;
            }
        } else if (options.uploadToFolder) {
            // Reference uploaded asset
            section += `![Slide ${i + 1}](/ppt-images/${imgFile})\n\n`;
        } else {
            // Just reference the filename
            section += `![Slide ${i + 1}](${imgFile})\n\n`;
        }

        section += '---\n\n';
    }

    return section;
}

async function main() {
    const options = parseArgs();

    // Validate required options
    if (!options.content || !fs.existsSync(options.content)) {
        console.error('Error: Content file not found. Use --content to specify.');
        process.exit(1);
    }
    if (!options.outputPath) {
        console.error('Error: Output path required. Use --output-path to specify.');
        process.exit(1);
    }
    if (!options.title) {
        console.error('Error: Title required. Use --title to specify.');
        process.exit(1);
    }

    console.log('Converting PPT to Wiki.js page...');
    console.log(`  Content: ${options.content}`);
    console.log(`  Images: ${options.images || 'None'}`);
    console.log(`  Output: ${options.outputPath}`);
    console.log(`  Title: ${options.title}`);
    console.log(`  Upload to folder: ${options.uploadToFolder || 'None'}`);
    console.log(`  Embed images: ${options.embedImages}\n`);

    // Read content
    const content = fs.readFileSync(options.content, 'utf8');

    // Initialize client
    const client = new WikiJSClient();

    // Upload images if specified
    let uploadedImages = [];
    if (options.uploadToFolder && options.images) {
        uploadedImages = await uploadImages(client, options.images, options.uploadToFolder);
    }

    // Build images section
    const imagesSection = createImagesSection(options.images, options, uploadedImages);

    // Combine content
    const fullContent = `# ${options.title}\n\n> 本文档由PPT自动转换生成\n\n${imagesSection}\n## 📝 详细内容\n\n${content}`;

    console.log('\nCreating wiki page...');

    // Create page
    const result = await client.createPage({
        path: options.outputPath,
        title: options.title,
        content: fullContent,
        locale: options.locale,
        description: `PPT转换 - ${options.title}`,
        tags: options.tags.split(',').map(t => t.trim()),
        isPublished: true,
        editor: 'markdown'
    });

    const response = result.data?.pages?.create;
    
    if (response?.responseResult?.succeeded) {
        const page = response.page;
        console.log(`\n[SUCCESS] Page created!`);
        console.log(`  Page ID: ${page.id}`);
        console.log(`  Path: ${page.path}`);
        console.log(`  URL: https://wiki.erix.vip/en/${page.path}`);
    } else {
        console.log(`\n[FAILED] ${response?.responseResult?.message || 'Unknown error'}`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
