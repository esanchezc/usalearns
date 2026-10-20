import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { createWorker } from 'tesseract.js';
import 'dotenv/config';

function resolveCsvPath() {
  const args = process.argv.slice(2);
  const csvArgIndex = args.indexOf('--csv');
  if (csvArgIndex !== -1 && args[csvArgIndex + 1]) {
    return path.resolve(args[csvArgIndex + 1]);
  }
  if (process.env.CSV_PATH) {
    return path.resolve(process.env.CSV_PATH);
  }
  if (fs.existsSync(path.resolve('Viviana F272.csv'))) {
    return path.resolve('Viviana F272.csv');
  }
  return path.resolve('Viviana F271.csv');
}

const CSV_FILE_PATH = resolveCsvPath();
const ISSUES_CSV_PATH = process.env.ISSUES_PATH || path.resolve('results/alumnos-con-problemas.csv');
const HEADLESS = process.env.HEADLESS !== 'false';

/**
 * Parsea el nombre en formato "Last name, First Name"
 */
function parseStudentName(fullName) {
  if (!fullName) return { firstName: 'Student', lastName: 'Student' };
  const parts = fullName.split(',').map(p => p.trim());
  if (parts.length >= 2) {
    const lastName = parts[0];
    const firstName = parts.slice(1).join(' ');
    return { firstName, lastName };
  }
  const spaceParts = fullName.split(' ').map(p => p.trim());
  return {
    firstName: spaceParts[0] || 'Student',
    lastName: spaceParts.slice(1).join(' ') || spaceParts[0] || 'Student',
  };
}

/**
 * Carga todos los estudiantes de la base de datos principal
 */
function loadAllStudentsMap() {
  const fileContent = fs.readFileSync(CSV_FILE_PATH, 'utf-8');
  const records = parse(fileContent, { relax_column_count: true, skip_empty_lines: true });
  const map = new Map();

  records.forEach((row, index) => {
    const lineNumber = index + 1;
    const id = (row[0] || '').trim();

    if (id && !id.startsWith('EX:') && !isNaN(Number(id))) {
      const domain = (row[1] || '@accesl.com').trim();
      const email = `${id}${domain}`;
      const password = (row[3] || id).trim();
      const rawName = row[2] ? row[2].trim() : '';
      const { firstName, lastName } = parseStudentName(rawName);

      const classKeys = [
        { name: 'Level 1', matchText: 'ACC Level 1', key: (row[4] || '').trim() },
        { name: 'Level 2', matchText: 'ACC Level 2', key: (row[5] || '').trim() },
        { name: 'Level 3', matchText: 'ACC Level 3', key: (row[6] || '').trim() },
        { name: 'Level 4', matchText: 'ACC Level 4', key: (row[7] || '').trim() },
        { name: 'Citizenship', matchText: 'ACC Citizenship', key: (row[8] || '').trim() },
        { name: 'America', matchText: 'ACC Access America', key: (row[9] || '').trim() },
      ].filter(c => c.key.length > 0);

      map.set(id, {
        lineNumber,
        id,
        email,
        password,
        rawName,
        firstName,
        lastName,
        classKeys,
      });
    }
  });

  return map;
}

/**
 * Carga los IDs que tuvieron problemas en la auditoría
 */
function loadIssuesStudents(studentMap) {
  if (!fs.existsSync(ISSUES_CSV_PATH)) {
    throw new Error(`No se encontró el archivo de problemas en: ${ISSUES_CSV_PATH}`);
  }

  const fileContent = fs.readFileSync(ISSUES_CSV_PATH, 'utf-8');
  const records = parse(fileContent, { columns: true, skip_empty_lines: true });

  const targetStudents = [];
  records.forEach(row => {
    const id = (row.ID || '').trim();
    if (studentMap.has(id)) {
      targetStudents.push(studentMap.get(id));
    }
  });

  return targetStudents;
}

/**
 * Configuración de red para velocidad
 */
async function setupPageOptimization(page) {
  await page.route('**/*', route => {
    const url = route.request().url();
    if (
      url.includes('googleads') ||
      url.includes('doubleclick') ||
      url.includes('googlesyndication') ||
      url.includes('youtube.com')
    ) {
      return route.abort();
    }
    return route.continue();
  });
}

/**
 * Resuelve Captcha con OCR
 */
async function solveMathCaptcha(page) {
  const captchaEl = page.locator('img[title="Captcha"]');
  await captchaEl.waitFor({ state: 'visible', timeout: 10000 });
  const buffer = await captchaEl.screenshot();

  const worker = await createWorker('eng');
  const ret = await worker.recognize(buffer);
  await worker.terminate();

  const text = ret.data.text.trim();
  const match = text.match(/(\d+)\s*([\+\-\*\/xX])\s*(\d+)/);
  if (!match) {
    throw new Error(`No se pudo leer Captcha: "${text}"`);
  }

  const num1 = parseInt(match[1], 10);
  const op = match[2];
  const num2 = parseInt(match[3], 10);
  let answer = 0;

  if (op === '+') answer = num1 + num2;
  else if (op === '-') answer = num1 - num2;
  else if (op === '*' || op.toLowerCase() === 'x') answer = num1 * num2;
  else if (op === '/') answer = Math.floor(num1 / num2);

  return answer.toString();
}

/**
 * Registra estudiante si no tiene cuenta
 */
async function registerStudent(page, student) {
  console.log(`   📝 Creando cuenta nueva para: ${student.rawName}...`);
  await page.goto('https://www.usalearns.org/student-registration', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  await page.locator('#EmailAddress').fill(student.email);
  await page.locator('#FirstName').fill(student.firstName);
  await page.locator('#LastName').fill(student.lastName);
  await page.locator('#Password').fill(student.password);
  await page.locator('#ConfirmPassword').fill(student.password);

  const captchaAnswer = await solveMathCaptcha(page);
  await page.locator('#Captcha_Value').fill(captchaAnswer);

  const screenshotsDir = path.resolve('screenshots/registrations');
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotsDir, `${student.id}-registration-form.png`) });

  await page.locator('#registerButton').click({ noWaitAfter: true });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  const pageText = await page.textContent('body');
  const isRegistered = pageText.includes('Sign off') || pageText.includes(student.email) || pageText.includes('My Home');

  if (isRegistered) {
    console.log(`   🎉 ¡Cuenta creada con éxito!`);
    await page.screenshot({ path: path.join(screenshotsDir, `${student.id}-registered-success.png`) });
    return true;
  }

  const errorEl = page.locator('.validation-summary-errors, .field-validation-error');
  const errorText = (await errorEl.first().isVisible().catch(() => false))
    ? (await errorEl.first().textContent()).trim()
    : 'Error al registrar';
  throw new Error(`Fallo registro: ${errorText}`);
}

/**
 * Asegura login
 */
async function ensureStudentLoggedIn(page, student) {
  await page.goto('https://www.usalearns.org/student-sign-in', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  await page.locator('#EmailAddress').fill(student.email);
  await page.locator('#Password').fill(student.password);
  await page.locator('input[name="submit"]').click({ noWaitAfter: true });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  const isSignOffVisible = await page.getByRole('link', { name: /sign off/i }).first().isVisible().catch(() => false);
  const pageText = await page.textContent('body');
  const isLoggedIn = isSignOffVisible || pageText.includes(student.email) || pageText.includes('My Home');

  if (isLoggedIn) {
    console.log(`   ✅ Sesión iniciada`);
    return true;
  }

  console.log(`   ⚠️ No se pudo iniciar sesión. Intentando auto-registro...`);
  return await registerStudent(page, student);
}

/**
 * Enrola solo las clases que falten
 */
async function enrollMissingClasses(page, student) {
  if (!page.url().includes('student-home')) {
    await page.goto('https://www.usalearns.org/student-home', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForTimeout(1000);
  }

  const homeText = await page.textContent('body');
  const missingClasses = student.classKeys.filter(c => !homeText.includes(c.matchText));

  if (missingClasses.length === 0) {
    console.log(`   ⚡ Ya tiene las 6 clases activas.`);
    return { success: true, count: 6, missing: [] };
  }

  console.log(`   ➡️ Faltan ${missingClasses.length} clases: ${missingClasses.map(m => m.name).join(', ')}`);

  for (const item of missingClasses) {
    process.stdout.write(`      ➡️ Enrolando en ${item.name} (${item.key})... `);
    await page.goto('https://www.usalearns.org/enroll-in-class', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await page.locator('#ClassKey').fill(item.key);
    await page.locator('input[value="Enroll!"]').click({ noWaitAfter: true });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
    console.log(`✅ OK`);
  }

  // Verificación final en Home
  await page.goto('https://www.usalearns.org/student-home', {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
  });
  await page.waitForTimeout(1000);

  const finalHomeText = await page.textContent('body');
  const finalMissing = student.classKeys.filter(c => !finalHomeText.includes(c.matchText));
  const finalCount = student.classKeys.length - finalMissing.length;

  const screenshotsDir = path.resolve('screenshots/enrolled');
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotsDir, `${student.id}-all-classes-enrolled.png`) });

  return {
    success: finalMissing.length === 0,
    count: finalCount,
    missing: finalMissing.map(m => m.name),
  };
}

/**
 * Función principal
 */
async function main() {
  const studentMap = loadAllStudentsMap();
  const targetStudents = loadIssuesStudents(studentMap);

  console.log(`============================================================`);
  console.log(`🔧 REPROCESANDO ALUMNOS CON PROBLEMAS`);
  console.log(`🎯 Total a reprocesar y reparar: ${targetStudents.length} alumnos`);
  console.log(`============================================================\n`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    slowMo: HEADLESS ? 0 : 50,
  });

  const results = [];

  for (let i = 0; i < targetStudents.length; i++) {
    const student = targetStudents[i];
    console.log(`[${i + 1}/${targetStudents.length}] [Fila ${student.lineNumber}] ID: ${student.id} (${student.rawName})`);

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await setupPageOptimization(page);

    const record = {
      row: student.lineNumber,
      id: student.id,
      name: student.rawName,
      email: student.email,
      fixed: false,
      status: '',
      notes: '',
    };

    try {
      await ensureStudentLoggedIn(page, student);
      const enrollRes = await enrollMissingClasses(page, student);

      if (enrollRes.success) {
        record.fixed = true;
        record.status = '✅ Reparado (6/6 clases)';
        record.notes = 'Completado con éxito en la segunda pasada';
        console.log(`   🎉 RESULTADO: ¡Reparado y completado al 100%! (6/6)\n`);
      } else {
        record.fixed = false;
        record.status = `⚠️ Incompleto (${enrollRes.count}/6)`;
        record.notes = `Faltan: ${enrollRes.missing.join(', ')}`;
        console.log(`   ⚠️ RESULTADO: Aún faltan clases (${enrollRes.missing.join(', ')})\n`);
      }
    } catch (err) {
      record.fixed = false;
      record.status = '❌ Requiere Revisión Manual';
      record.notes = err.message;
      console.log(`   ❌ RESULTADO: Error persistente -> ${err.message}\n`);
    } finally {
      await context.close();
      results.push(record);
    }
  }

  await browser.close();

  // Guardar archivo final filtrado
  const resultsDir = path.resolve('results');
  const trulyManualIssues = results.filter(r => !r.fixed);
  const fixedCount = results.filter(r => r.fixed).length;

  const finalCsvHeader = 'Fila_CSV,ID,Nombre,Email,Estado,Motivo_Revision_Manual\n';
  const finalCsvRows = trulyManualIssues
    .map(r => `${r.row},"${r.id}","${r.name.replace(/"/g, '""')}","${r.email}","${r.status}","${r.notes.replace(/"/g, '""')}"`)
    .join('\n');

  const finalCsvPath = path.join(resultsDir, 'alumnos-revision-manual-final.csv');
  fs.writeFileSync(finalCsvPath, finalCsvHeader + finalCsvRows, 'utf-8');

  console.log(`\n============================================================`);
  console.log(`📊 BALANCE FINAL DEL REPROCESAMIENTO`);
  console.log(`============================================================`);
  console.log(`👥 Total con problemas iniciales: ${results.length}`);
  console.log(`✅ Reparados automáticamente (6/6 completos): ${fixedCount}`);
  console.log(`❌ Casos reales que requieren revisión manual: ${trulyManualIssues.length}\n`);

  if (trulyManualIssues.length > 0) {
    console.log(`⚠️ LISTA DEFINITIVA PARA REVISIÓN MANUAL:`);
    console.table(
      trulyManualIssues.map(s => ({
        Fila: s.row,
        ID: s.id,
        Nombre: s.name,
        Estado: s.status,
        Detalle: s.notes,
      }))
    );
    console.log(`\n📁 Archivo CSV final generado:`);
    console.log(`   👉 ${finalCsvPath}`);
  } else {
    console.log(`🎉 ¡TODOS LOS CASOS PENDIENTES FUERON RESUELTOS AL 100%!`);
  }
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
