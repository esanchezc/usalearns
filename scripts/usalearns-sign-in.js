import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { createWorker } from 'tesseract.js';
import 'dotenv/config';

// Configuración general
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
 * Parsea el archivo CSV y extrae la lista de estudiantes con sus class keys
 */
function loadStudentsFromCsv(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`El archivo CSV no existe en la ruta: ${filePath}`);
  }

  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const records = parse(fileContent, {
    relax_column_count: true,
    skip_empty_lines: true,
  });

  const students = [];

  records.forEach((row, index) => {
    const lineNumber = index + 1;
    const id = (row[0] || '').trim();

    if (id && !id.startsWith('EX:') && !isNaN(Number(id))) {
      const domain = (row[1] || '@accesl.com').trim();
      const email = `${id}${domain}`;
      const password = (row[3] || id).trim();
      const rawName = row[2] ? row[2].trim() : '';
      const { firstName, lastName } = parseStudentName(rawName);

      // Claves de clase por columna con el texto exacto que aparece cuando está enrolada
      const classKeys = [
        { name: 'Level 1', matchText: 'ACC Level 1', key: (row[4] || '').trim() },
        { name: 'Level 2', matchText: 'ACC Level 2', key: (row[5] || '').trim() },
        { name: 'Level 3', matchText: 'ACC Level 3', key: (row[6] || '').trim() },
        { name: 'Level 4', matchText: 'ACC Level 4', key: (row[7] || '').trim() },
        { name: 'Citizenship', matchText: 'ACC Citizenship', key: (row[8] || '').trim() },
        { name: 'America', matchText: 'ACC Access America', key: (row[9] || '').trim() },
      ].filter(c => c.key.length > 0);

      students.push({
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

  return students;
}

/**
 * Configura rutas y bloquea dominios de publicidad pesados para evitar bloqueos
 */
async function setupPageOptimization(page) {
  await page.route('**/*', route => {
    const url = route.request().url();
    if (
      url.includes('googleads') ||
      url.includes('doubleclick') ||
      url.includes('googlesyndication') ||
      url.includes('adservice.google') ||
      url.includes('youtube.com')
    ) {
      return route.abort();
    }
    return route.continue();
  });
}

/**
 * Resuelve el Captcha matemático usando Tesseract OCR
 */
async function solveMathCaptcha(page) {
  const captchaEl = page.locator('img[title="Captcha"]');
  await captchaEl.waitFor({ state: 'visible', timeout: 10000 });
  const buffer = await captchaEl.screenshot();

  const worker = await createWorker('eng');
  const ret = await worker.recognize(buffer);
  await worker.terminate();

  const text = ret.data.text.trim();
  console.log(`   🔢 Captcha OCR: "${text}"`);

  const match = text.match(/(\d+)\s*([\+\-\*\/xX])\s*(\d+)/);
  if (!match) {
    throw new Error(`No se pudo interpretar el Captcha: "${text}"`);
  }

  const num1 = parseInt(match[1], 10);
  const op = match[2];
  const num2 = parseInt(match[3], 10);
  let answer = 0;

  if (op === '+') answer = num1 + num2;
  else if (op === '-') answer = num1 - num2;
  else if (op === '*' || op.toLowerCase() === 'x') answer = num1 * num2;
  else if (op === '/') answer = Math.floor(num1 / num2);

  console.log(`   🧮 Ecuación resuelta: ${num1} ${op} ${num2} = ${answer}`);
  return answer.toString();
}

/**
 * Registra un estudiante si no tiene cuenta con reintentos automáticos
 */
async function registerStudent(page, student, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📝 [Intento ${attempt}/${maxRetries}] Registrando nueva cuenta para: ${student.rawName}...`);

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
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
      }

      await page.screenshot({ path: path.join(screenshotsDir, `${student.id}-registration-form.png`) });

      await page.locator('#registerButton').click({ noWaitAfter: true });
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      const pageText = await page.textContent('body');
      const isRegistered = pageText.includes('Sign off') || pageText.includes(student.email) || pageText.includes('My Home');

      if (isRegistered) {
        console.log(`🎉 ¡Cuenta creada con éxito!`);
        await page.screenshot({ path: path.join(screenshotsDir, `${student.id}-registered-success.png`) });
        return true;
      }

      const errorEl = page.locator('.validation-summary-errors, .field-validation-error');
      const errorText = (await errorEl.first().isVisible().catch(() => false))
        ? (await errorEl.first().textContent()).trim()
        : 'Error en formulario';
      
      console.log(`⚠️ Intento ${attempt} falló: ${errorText}`);
      if (attempt === maxRetries) {
        throw new Error(`Fallo definitivo en registro: ${errorText}`);
      }
    } catch (err) {
      if (attempt === maxRetries) throw err;
      console.log(`⚠️ Reintentando registro por error: ${err.message}...`);
      await page.waitForTimeout(1000);
    }
  }
  return false;
}

/**
 * Inicia sesión para un estudiante (o lo registra si no existe)
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
    console.log(`✅ Sesión iniciada para ${student.email}`);
    return true;
  }

  console.log(`⚠️ Cuenta no existe o login falló. Registrando automáticamente...`);
  return await registerStudent(page, student);
}

/**
 * Enrola al estudiante con comprobación precisa de materias faltantes
 */
async function enrollInClasses(page, student) {
  if (!page.url().includes('student-home')) {
    await page.goto('https://www.usalearns.org/student-home', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForTimeout(1000);
  }

  const initialHomeText = await page.textContent('body');

  // Identificar con precisión cuáles materias ya están enroladas y cuáles faltan
  const enrolledClasses = student.classKeys.filter(c => initialHomeText.includes(c.matchText));
  const missingClasses = student.classKeys.filter(c => !initialHomeText.includes(c.matchText));

  // Si ya tiene todas sus clases enroladas, Fast-Skip instantáneo
  if (missingClasses.length === 0) {
    console.log(`⚡ [FAST-SKIP] Estudiante ya tiene todas sus ${student.classKeys.length} clases activas con "with ACC".`);
    return {
      confirmedClassesWithAcc: student.classKeys.length,
      skipped: true,
      screenshotPath: null,
    };
  }

  console.log(`📚 Estado actual: ${enrolledClasses.length}/${student.classKeys.length} clases enroladas.`);
  console.log(`➡️ Faltan por enrolar (${missingClasses.length}): ${missingClasses.map(m => m.name).join(', ')}`);

  for (const item of missingClasses) {
    process.stdout.write(`   ➡️ Enrolando en ${item.name} (Key: ${item.key})... `);

    await page.goto('https://www.usalearns.org/enroll-in-class', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await page.locator('#ClassKey').fill(item.key);
    await page.locator('input[value="Enroll!"]').click({ noWaitAfter: true });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    const pageText = await page.textContent('body');

    if (pageText.includes('already a student in that class')) {
      console.log(`ℹ️ Ya estaba enrolado previamente`);
    } else if (page.url().includes('student-home') || pageText.includes('with ACC') || pageText.includes('My Home')) {
      console.log(`✅ Enrolado exitosamente`);
    } else {
      console.log(`⚠️ Estado indeterminado`);
    }
  }

  // Verificación final en Home
  console.log(`🏠 Verificando clases activas en Home...`);
  await page.goto('https://www.usalearns.org/student-home', {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
  });
  await page.waitForTimeout(1000);

  const homeText = await page.textContent('body');
  const finalEnrolled = student.classKeys.filter(c => homeText.includes(c.matchText)).length;
  console.log(`🎓 Total de clases confirmadas con "with ACC": ${finalEnrolled}/${student.classKeys.length}`);

  const screenshotsDir = path.resolve('screenshots/enrolled');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }
  const screenshotPath = path.join(screenshotsDir, `${student.id}-all-classes-enrolled.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  return {
    confirmedClassesWithAcc: finalEnrolled,
    skipped: false,
    screenshotPath,
  };
}

/**
 * Procesa a un estudiante completo
 */
async function processStudent(browser, student, index, total) {
  console.log(`\n============================================================`);
  console.log(`[${index + 1}/${total}] [Fila CSV ${student.lineNumber}] Estudiante: ${student.rawName} (ID: ${student.id})`);
  console.log(`📧 Email: ${student.email}`);
  console.log(`============================================================`);

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await setupPageOptimization(page);

  const result = {
    row: student.lineNumber,
    id: student.id,
    name: student.rawName,
    email: student.email,
    classesTotal: student.classKeys.length,
    classesEnrolled: 0,
    status: '',
  };

  try {
    await ensureStudentLoggedIn(page, student);
    const enrollInfo = await enrollInClasses(page, student);

    result.classesEnrolled = enrollInfo.confirmedClassesWithAcc;
    result.status = enrollInfo.skipped
      ? `⚡ Omitido (Ya tenía ${enrollInfo.confirmedClassesWithAcc}/${student.classKeys.length} clases)`
      : `✅ ${enrollInfo.confirmedClassesWithAcc}/${student.classKeys.length} clases con "with ACC"`;
  } catch (err) {
    result.status = `❌ Error: ${err.message}`;
    console.error(`❌ Error en proceso: ${err.message}`);
  } finally {
    await context.close();
  }

  return result;
}

/**
 * Función principal
 */
async function main() {
  const allStudents = loadStudentsFromCsv(CSV_FILE_PATH);
  console.log(`📄 Archivo cargado: ${path.basename(CSV_FILE_PATH)}`);
  console.log(`👥 Total de estudiantes disponibles: ${allStudents.length}`);

  const args = process.argv.slice(2);
  let targetStudents = [];

  const rangeArgIndex = args.indexOf('--range');
  const studentIdArgIndex = args.indexOf('--student');
  const isAll = args.includes('--all');

  if (isAll) {
    targetStudents = allStudents;
    console.log(`🎯 Modo ALL: Procesando TODOS los ${targetStudents.length} estudiantes...`);
  } else if (rangeArgIndex !== -1 && args[rangeArgIndex + 1]) {
    const [start, end] = args[rangeArgIndex + 1].split('-').map(n => parseInt(n.trim(), 10));
    targetStudents = allStudents.filter(s => s.lineNumber >= start && s.lineNumber <= end);
    console.log(`🎯 Rango seleccionado: Filas ${start} a ${end}`);
  } else if (studentIdArgIndex !== -1 && args[studentIdArgIndex + 1]) {
    const targetId = args[studentIdArgIndex + 1].trim();
    targetStudents = allStudents.filter(s => s.id === targetId);
  } else if (args.length > 0 && !isNaN(Number(args[0]))) {
    const limit = parseInt(args[0], 10);
    targetStudents = limit > 0 ? allStudents.slice(0, limit) : allStudents;
  } else {
    targetStudents = allStudents.slice(0, 3);
  }

  if (targetStudents.length === 0) {
    throw new Error('No se encontraron estudiantes para procesar con los criterios dados.');
  }

  console.log(`🎯 Procesando ${targetStudents.length} estudiante(s)...`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    slowMo: HEADLESS ? 0 : 50,
  });

  const summary = [];
  for (let i = 0; i < targetStudents.length; i++) {
    const res = await processStudent(browser, targetStudents[i], i, targetStudents.length);
    summary.push(res);
  }

  await browser.close();

  // Guardar log de resultados en JSON para trazabilidad
  const resultsDir = path.resolve('results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }
  const resultsFilePath = path.join(resultsDir, 'last-run-results.json');
  fs.writeFileSync(resultsFilePath, JSON.stringify(summary, null, 2));

  // Resumen final
  console.log(`\n============================================================`);
  console.log(`📊 RESUMEN GENERAL DE ENROLAMIENTO`);
  console.log(`============================================================`);
  console.table(
    summary.map(s => ({
      Fila: s.row,
      ID: s.id,
      Nombre: s.name,
      Email: s.email,
      'Clases Enroladas': s.classesEnrolled,
      Resultado: s.status,
    }))
  );

  const totalSuccess = summary.filter(s => s.classesEnrolled >= s.classesTotal).length;
  console.log(`\n🏆 Total completados exitosamente: ${totalSuccess}/${summary.length}`);
  console.log(`💾 Reporte guardado en: ${resultsFilePath}`);
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
