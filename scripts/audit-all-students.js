import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import 'dotenv/config';

const CSV_FILE_PATH = process.env.CSV_PATH || path.resolve('Viviana F271.csv');
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
 * Parsea el archivo CSV
 */
function loadStudentsFromCsv(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`El archivo CSV no existe: ${filePath}`);
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
 * Audita el estado de un estudiante en menos de 2 segundos
 */
async function auditStudent(page, student, index, total) {
  process.stdout.write(`[${index + 1}/${total}] [Fila ${student.lineNumber}] ID: ${student.id} (${student.rawName})... `);

  const result = {
    row: student.lineNumber,
    id: student.id,
    name: student.rawName,
    email: student.email,
    loginOk: false,
    enrolledClasses: 0,
    totalClasses: student.classKeys.length,
    missingClasses: [],
    status: '',
    notes: '',
  };

  try {
    // 1. Navegar e intentar Login
    await page.goto('https://www.usalearns.org/student-sign-in', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await page.locator('#EmailAddress').fill(student.email);
    await page.locator('#Password').fill(student.password);
    await page.locator('input[name="submit"]').click({ noWaitAfter: true });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1200);

    const isSignOffVisible = await page.getByRole('link', { name: /sign off/i }).first().isVisible().catch(() => false);
    const homeText = await page.textContent('body');
    const isLoggedIn = isSignOffVisible || homeText.includes(student.email) || homeText.includes('My Home');

    if (!isLoggedIn) {
      const errorEl = page.locator('.validation-summary-errors, .field-validation-error');
      const errorMsg = (await errorEl.first().isVisible().catch(() => false))
        ? (await errorEl.first().textContent()).trim()
        : 'Credenciales inválidas / Cuenta no existe';

      result.loginOk = false;
      result.status = '❌ Fallo Login';
      result.notes = errorMsg;
      console.log(`❌ Login falló (${errorMsg})`);
      return result;
    }

    result.loginOk = true;

    // 2. Verificar Home y clases enroladas
    if (!page.url().includes('student-home')) {
      await page.goto('https://www.usalearns.org/student-home', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(800);
    }

    const currentHomeText = await page.textContent('body');
    const missing = student.classKeys.filter(c => !currentHomeText.includes(c.matchText));
    const enrolledCount = student.classKeys.length - missing.length;

    result.enrolledClasses = enrolledCount;
    result.missingClasses = missing.map(m => m.name);

    if (missing.length === 0) {
      result.status = '✅ Completo (6/6)';
      result.notes = 'Todas las clases verificadas con ACC';
      console.log(`✅ 6/6 clases activas`);
    } else {
      result.status = `⚠️ Incompleto (${enrolledCount}/${student.classKeys.length})`;
      result.notes = `Faltan: ${missing.map(m => m.name).join(', ')}`;
      console.log(`⚠️ Incompleto (${enrolledCount}/${student.classKeys.length}). Faltan: ${result.notes}`);
    }
  } catch (err) {
    result.status = '❌ Error';
    result.notes = err.message;
    console.log(`❌ Error: ${err.message}`);
  }

  return result;
}

/**
 * Función principal de Auditoría
 */
async function main() {
  const allStudents = loadStudentsFromCsv(CSV_FILE_PATH);
  console.log(`============================================================`);
  console.log(`🔎 INICIANDO AUDITORÍA FINAL DE ESTUDIANTES`);
  console.log(`📄 Archivo: ${path.basename(CSV_FILE_PATH)}`);
  console.log(`👥 Total en base de datos: ${allStudents.length} estudiantes`);
  console.log(`============================================================\n`);

  const args = process.argv.slice(2);
  let targetStudents = allStudents;

  const rangeArgIndex = args.indexOf('--range');
  if (rangeArgIndex !== -1 && args[rangeArgIndex + 1]) {
    const [start, end] = args[rangeArgIndex + 1].split('-').map(n => parseInt(n.trim(), 10));
    targetStudents = allStudents.filter(s => s.lineNumber >= start && s.lineNumber <= end);
    console.log(`🎯 Rango a auditar: Filas ${start} a ${end} (${targetStudents.length} estudiantes)\n`);
  }

  const browser = await chromium.launch({
    headless: HEADLESS,
    slowMo: 0,
  });

  const auditResults = [];

  for (let i = 0; i < targetStudents.length; i++) {
    const student = targetStudents[i];
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    // Bloqueo de publicidad para máxima velocidad
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.includes('googleads') || url.includes('doubleclick') || url.includes('googlesyndication') || url.includes('youtube.com')) {
        return route.abort();
      }
      return route.continue();
    });

    const res = await auditStudent(page, student, i, targetStudents.length);
    auditResults.push(res);
    await context.close();
  }

  await browser.close();

  // Filtrar los que tienen problemas
  const studentsWithIssues = auditResults.filter(r => !r.loginOk || r.missingClasses.length > 0);
  const fullyCompleted = auditResults.filter(r => r.loginOk && r.missingClasses.length === 0);

  // Guardar archivo CSV con los alumnos con problemas para revisión manual
  const resultsDir = path.resolve('results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const csvHeader = 'Fila_CSV,ID,Nombre,Email,Estado,Clases_Enroladas,Total_Clases,Materias_Faltantes,Detalles\n';
  const csvRows = studentsWithIssues
    .map(
      r =>
        `${r.row},"${r.id}","${r.name.replace(/"/g, '""')}","${r.email}","${r.status}",${r.enrolledClasses},${r.totalClasses},"${r.missingClasses.join('; ')}","${r.notes.replace(/"/g, '""')}"`
    )
    .join('\n');

  const issuesCsvPath = path.join(resultsDir, 'alumnos-con-problemas.csv');
  fs.writeFileSync(issuesCsvPath, csvHeader + csvRows, 'utf-8');

  const fullReportJsonPath = path.join(resultsDir, 'reporte-auditoria-completa.json');
  fs.writeFileSync(fullReportJsonPath, JSON.stringify(auditResults, null, 2), 'utf-8');

  // Reporte en Consola
  console.log(`\n============================================================`);
  console.log(`📊 REPORTE FINAL DE AUDITORÍA`);
  console.log(`============================================================`);
  console.log(`👥 Total auditados: ${auditResults.length}`);
  console.log(`✅ 100% Completos (6/6 clases activas): ${fullyCompleted.length} (${Math.round((fullyCompleted.length / auditResults.length) * 100)}%)`);
  console.log(`⚠️ Con observaciones / pendientes: ${studentsWithIssues.length}\n`);

  if (studentsWithIssues.length > 0) {
    console.log(`⚠️ LISTA DE ALUMNOS CON PROBLEMAS PARA REVISIÓN MANUAL:`);
    console.table(
      studentsWithIssues.map(s => ({
        Fila: s.row,
        ID: s.id,
        Nombre: s.name,
        Email: s.email,
        Estado: s.status,
        Detalle: s.notes,
      }))
    );
    console.log(`\n📁 Archivo CSV listo para abrir en Excel/Numbers:`);
    console.log(`   👉 ${issuesCsvPath}`);
  } else {
    console.log(`🎉 ¡EXCELENTE! Todos los ${auditResults.length} estudiantes están 100% registrados y con sus 6 clases activas.`);
  }
}

main().catch(err => {
  console.error('Error en auditoría:', err);
  process.exit(1);
});
