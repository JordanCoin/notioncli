const fs = require('fs');
const path = require('path');

module.exports = {
  register(program, ctx) {
    const {
      getNotion,
      resolvePageId,
      jsonOutput,
      runCommand,
    } = ctx;

    program
      .command('upload <page-or-alias> <file-path>')
      .description('Upload a file to a page')
      .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
      .action(async (target, filePath, opts, cmd) => runCommand('Upload', async () => {
        const notion = getNotion();
        const { pageId } = await resolvePageId(target, opts.filter);

        // Resolve file path
        const absPath = path.resolve(filePath);
        if (!fs.existsSync(absPath)) {
          console.error(`File not found: ${absPath}`);
          process.exit(1);
        }

        const filename = path.basename(absPath);
        const fileData = fs.readFileSync(absPath);
        const fileSize = fileData.length;

        // Detect MIME type from extension
        const MIME_MAP = {
          '.txt': 'text/plain', '.csv': 'text/csv', '.html': 'text/html',
          '.json': 'application/json', '.pdf': 'application/pdf',
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
          '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
          '.zip': 'application/zip', '.doc': 'application/msword',
          '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.xls': 'application/vnd.ms-excel',
          '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        };
        const ext = path.extname(filename).toLowerCase();
        const mimeType = MIME_MAP[ext] || 'application/octet-stream';

        // Step 1: Create file upload
        const upload = await notion.fileUploads.create({
          parent: { type: 'page_id', page_id: pageId },
          filename,
        });
        const uploadId = upload.id;

        // Step 2: Send file data with correct content type
        await notion.fileUploads.send({
          file_upload_id: uploadId,
          file: { data: new Blob([fileData], { type: mimeType }), filename },
          part_number: '1',
        });

        // Step 3: Append file block to page (no complete() needed — attach directly)
        await notion.blocks.children.append({
          block_id: pageId,
          children: [{
            object: 'block',
            type: 'file',
            file: {
              type: 'file_upload',
              file_upload: { id: uploadId },
            },
          }],
        });

        if (jsonOutput(cmd, { upload_id: uploadId, filename, size: fileSize, page_id: pageId })) return;

        const sizeStr = fileSize > 1024 * 1024
          ? `${(fileSize / (1024 * 1024)).toFixed(1)} MB`
          : `${(fileSize / 1024).toFixed(1)} KB`;

        console.log(`✅ Uploaded: ${filename} (${sizeStr})`);
        console.log(`   Page: ${pageId.slice(0, 8)}…`);
      }));
  },
};
