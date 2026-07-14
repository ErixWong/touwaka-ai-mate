import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const DEFAULT_SAMPLE_FILE = 'D:\\seafile\\temp_files\\临时文件\\2026\\06\\C518-85-RR_1.csv';
const TARGET_ALGORITHMS = new Set([
  'envelope_turning_points_v3',
  'structural_profile_v1',
  'structural_profile_v2',
  'structural_cusum_v1',
]);

function resolveSampleFiles() {
  if (process.argv.includes('--suite')) {
    return [
      'D:\\seafile\\temp_files\\临时文件\\2026\\06\\C518-85-FL_1.csv',
      'D:\\seafile\\temp_files\\临时文件\\2026\\06\\C518-85-FR_1.csv',
      'D:\\seafile\\temp_files\\临时文件\\2026\\06\\C518-85-RL_1.csv',
      'D:\\seafile\\temp_files\\临时文件\\2026\\06\\C518-85-RR_1.csv',
      'D:\\seafile\\temp_files\\临时文件\\2026\\06\\scope_0.1.csv',
    ].filter(file => fs.existsSync(file));
  }

  const explicitFile = process.argv.find((arg, index) => index >= 2 && arg !== '--suite');
  return [explicitFile || DEFAULT_SAMPLE_FILE];
}

function runCompareScript(sampleFile) {
  const result = spawnSync('node', ['scripts/compare-cfa-compression-algorithms.js', sampleFile], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `compare script failed: ${result.status}`);
  }

  return result.stdout;
}

function extractAlgorithmBlocks(output) {
  const lines = output.split(/\r?\n/);
  const summaries = [];
  const previews = [];
  let currentMode = null;
  let currentAlgorithm = null;
  let currentLines = [];

  const flush = () => {
    if (!currentAlgorithm || !TARGET_ALGORITHMS.has(currentAlgorithm) || currentLines.length === 0) {
      currentAlgorithm = null;
      currentLines = [];
      currentMode = null;
      return;
    }

    const block = {
      algorithm: currentAlgorithm,
      text: currentLines.join('\n').trim(),
    };
    if (currentMode === 'summary') {
      summaries.push(block);
    } else if (currentMode === 'preview') {
      previews.push(block);
    }

    currentAlgorithm = null;
    currentLines = [];
    currentMode = null;
  };

  for (const line of lines) {
    const summaryMatch = line.match(/^(\w+):\s/);
    const previewMatch = line.match(/^========== LLM 输入预览 - (\w+) ==========$/);

    if (summaryMatch && TARGET_ALGORITHMS.has(summaryMatch[1])) {
      flush();
      currentMode = 'summary';
      currentAlgorithm = summaryMatch[1];
      currentLines = [line];
      continue;
    }

    if (previewMatch && TARGET_ALGORITHMS.has(previewMatch[1])) {
      flush();
      currentMode = 'preview';
      currentAlgorithm = previewMatch[1];
      currentLines = [line];
      continue;
    }

    if (currentMode && line.startsWith('========== ') && !line.includes(currentAlgorithm)) {
      flush();
      continue;
    }

    if (currentMode === 'summary' && line.match(/^\w+:\s/) && !line.startsWith(`${currentAlgorithm}:`)) {
      flush();
      continue;
    }

    if (currentMode) {
      currentLines.push(line);
    }
  }

  flush();
  return { summaries, previews };
}

function printFocusedReport(sampleFile, blocks) {
  console.log(`\n################ ${sampleFile} ################`);
  console.log('\n========== 聚焦摘要 ==========' );
  for (const block of blocks.summaries) {
    console.log(block.text);
    console.log('');
  }
  console.log('========== 聚焦预览 ==========' );
  for (const block of blocks.previews) {
    console.log(block.text);
    console.log('');
  }
}

function main() {
  const sampleFiles = resolveSampleFiles();
  if (sampleFiles.length === 0) {
    throw new Error('没有找到可用样本文件');
  }

  for (const sampleFile of sampleFiles) {
    if (!fs.existsSync(sampleFile)) {
      throw new Error(`样本文件不存在: ${sampleFile}`);
    }
    const output = runCompareScript(sampleFile);
    const blocks = extractAlgorithmBlocks(output);
    printFocusedReport(sampleFile, blocks);
  }
}

main();
