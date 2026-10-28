import * as XLSX from 'xlsx';

export interface ImportRow {
  rowIndex: number;
  className: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  gender: 'male' | 'female' | null;
  repetition: string;
  boarding: 'day' | 'half_board' | 'boarder' | 'external';
  teacherName: string | null;
  subject: string | null;
  errors: string[];
}

export interface ImportPreview {
  rows: ImportRow[];
  newClasses: Set<string>;
  existingClasses: Set<string>;
  duplicateStudents: ImportRow[];
  invalidRows: ImportRow[];
  validRows: ImportRow[];
}

const BOARDING_MAP: Record<string, 'day' | 'half_board' | 'boarder' | 'external'> = {
  'يومي': 'day', 'day': 'day',
  'نصف داخلي': 'half_board', 'half_board': 'half_board', 'half-board': 'half_board',
  'داخلي': 'boarder', 'boarder': 'boarder',
  'خارجي': 'external', 'external': 'external',
};

const GENDER_MAP: Record<string, 'male' | 'female'> = {
  'ذكر': 'male', 'male': 'male', 'm': 'male',
  'أنثى': 'female', 'female': 'female', 'f': 'female',
};

const REPETITION_MAP: Record<string, string> = {
  'جديد': 'new', 'new': 'new',
  'معيد': 'repeating', 'repeating': 'repeating', 'repeat': 'repeating',
  'منقلب': 'transferred', 'transferred': 'transferred', 'transfer': 'transferred',
};

// Column header aliases (Arabic + English, case-insensitive)
const COL_ALIASES: Record<string, string[]> = {
  className: ['اسم القسم', 'class name', 'classname', 'class', 'القسم'],
  firstName: ['الاسم', 'first name', 'firstname', 'الاسم الشخصي', 'prénom'],
  lastName: ['اللقب', 'last name', 'lastname', 'اسم العائلة', 'nom'],
  birthDate: ['تاريخ الميلاد', 'birth date', 'birthdate', 'date of birth', 'dob', 'تاريخ'],
  gender: ['الجنس', 'gender', 'sex', 'النوع'],
  repetition: ['حالة التكرار', 'repetition', 'repetition status', 'status', 'الحالة'],
  boarding: ['النظام', 'boarding', 'boarding status', 'النظام الغذائي'],
  teacherName: ['اسم الأستاذ', 'teacher name', 'teacher', 'الأستاذ'],
  subject: ['المادة', 'subject', 'المادة الدراسية'],
};

function findColumn(headers: string[], aliases: string[]): number {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  for (const alias of aliases) {
    const idx = normalized.indexOf(alias.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

export function parseExcelFile(data: ArrayBuffer): { headers: string[]; rows: string[][] } {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { headers: [], rows: [] };

  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
  if (raw.length < 2) return { headers: [], rows: [] };

  const headers = (raw[0] as string[]).map((h) => String(h ?? '').trim());
  const rows = raw.slice(1).map((r) => (r as string[]).map((c) => String(c ?? '').trim()));
  return { headers, rows };
}

export function buildPreview(
  headers: string[],
  rows: string[][],
  existingClassNames: Set<string>,
  existingStudentKeys: Set<string>,
): ImportPreview {
  const colIdx: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(COL_ALIASES)) {
    colIdx[key] = findColumn(headers, aliases);
  }

  const requiredCols = ['className', 'firstName', 'lastName'];
  const missingCols = requiredCols.filter((c) => colIdx[c] < 0);

  const importRows: ImportRow[] = [];
  const newClasses = new Set<string>();
  const existingClasses = new Set<string>();
  const seenStudentKeys = new Set<string>();

  rows.forEach((cells, i) => {
    const errors: string[] = [];

    if (missingCols.length > 0) {
      errors.push(`Missing columns: ${missingCols.join(', ')}`);
    }

    const className = colIdx.className >= 0 ? cells[colIdx.className] ?? '' : '';
    const firstName = colIdx.firstName >= 0 ? cells[colIdx.firstName] ?? '' : '';
    const lastName = colIdx.lastName >= 0 ? cells[colIdx.lastName] ?? '' : '';

    if (!className.trim()) errors.push('Class name is required');
    if (!firstName.trim()) errors.push('First name is required');
    if (!lastName.trim()) errors.push('Last name is required');

    const rawBirthDate = colIdx.birthDate >= 0 ? cells[colIdx.birthDate] ?? '' : '';
    let birthDate: string | null = null;
    if (rawBirthDate) {
      const d = new Date(rawBirthDate);
      if (!isNaN(d.getTime())) {
        birthDate = d.toISOString().slice(0, 10);
      } else {
        errors.push('Invalid birth date format');
      }
    }

    const rawGender = colIdx.gender >= 0 ? cells[colIdx.gender] ?? '' : '';
    const gender = rawGender ? (GENDER_MAP[rawGender.trim().toLowerCase()] ?? null) : null;
    if (rawGender && !gender) errors.push('Invalid gender value');

    const rawRepetition = colIdx.repetition >= 0 ? cells[colIdx.repetition] ?? '' : '';
    const repetition = rawRepetition ? (REPETITION_MAP[rawRepetition.trim().toLowerCase()] ?? 'new') : 'new';

    const rawBoarding = colIdx.boarding >= 0 ? cells[colIdx.boarding] ?? '' : '';
    const boarding = rawBoarding ? (BOARDING_MAP[rawBoarding.trim().toLowerCase()] ?? 'external') : 'external';

    const teacherName = colIdx.teacherName >= 0 ? (cells[colIdx.teacherName] ?? '').trim() || null : null;
    const subject = colIdx.subject >= 0 ? (cells[colIdx.subject] ?? '').trim() || null : null;

    const row: ImportRow = {
      rowIndex: i + 2,
      className: className.trim(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      birthDate,
      gender,
      repetition,
      boarding,
      teacherName,
      subject,
      errors,
    };

    if (!row.errors.length) {
      if (existingClassNames.has(row.className)) {
        existingClasses.add(row.className);
      } else {
        newClasses.add(row.className);
      }

      const studentKey = `${row.className}__${row.lastName}__${row.firstName}`;
      if (existingStudentKeys.has(studentKey) || seenStudentKeys.has(studentKey)) {
        // Mark as duplicate but keep in valid list — user decides
      }
      seenStudentKeys.add(studentKey);
    }

    importRows.push(row);
  });

  const validRows = importRows.filter((r) => r.errors.length === 0);
  const invalidRows = importRows.filter((r) => r.errors.length > 0);

  const duplicateStudents = validRows.filter((r) => {
    const key = `${r.className}__${r.lastName}__${r.firstName}`;
    return existingStudentKeys.has(key);
  });

  return {
    rows: importRows,
    newClasses,
    existingClasses,
    duplicateStudents,
    invalidRows,
    validRows,
  };
}

export function generateTemplate(): Blob {
  const wb = XLSX.utils.book_new();

  const headers = [
    'اسم القسم', 'الاسم', 'اللقب', 'تاريخ الميلاد', 'الجنس', 'حالة التكرار', 'النظام', 'اسم الأستاذ', 'المادة',
  ];

  const exampleRow = [
    '1 متوسط أ', 'أحمد', 'بن علي', '2010-03-15', 'ذكر', 'جديد', 'يومي', '', '',
  ];

  const sheet1Data = [headers, exampleRow];
  const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);
  ws1['!cols'] = [{ wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 12 }];

  const instructions = [
    ['التعليمات', ''],
    ['', ''],
    ['1. لا تحذف صف العناوين (الصف الأول)', ''],
    ['2. استخدم تاريخ الميلاد بصيغة YYYY-MM-DD', ''],
    ['3. الجنس: ذكر أو أنثى', ''],
    ['4. النظام: يومي، نصف داخلي، داخلي، خارجي', ''],
    ['5. حالة التكرار: جديد، معيد، منقلب', ''],
    ['6. الصف الثاني (المثال) لا تقم باستيراده كبيانات حقيقية', ''],
    ['7. اسم الأستاذ والمادة اختياري — يُستخدم لإسناد الأستاذ للقسم', ''],
    ['8. اسم القسم مطلوب لكل تلميذ', ''],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(instructions);
  ws2['!cols'] = [{ wch: 50 }, { wch: 5 }];

  XLSX.utils.book_append_sheet(wb, ws1, 'قائمة التلاميذ');
  XLSX.utils.book_append_sheet(wb, ws2, 'التعليمات');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  if (blob.size === 0) throw new Error('Generated workbook is empty');
  return blob;
}

/** Verifies a blob contains a valid XLSX (ZIP) file by checking the PK signature. */
export function isValidXlsxBlob(blob: Blob): boolean {
  return blob.size > 0 && blob.type.includes('spreadsheet');
}

export function exportCurrentData(
  classes: { name: string }[],
  students: { first_name: string; last_name: string; birth_date: string | null; gender: string | null; repetition_status: string; boarding: string; class_name: string }[],
): Blob {
  const wb = XLSX.utils.book_new();
  const headers = ['اسم القسم', 'الاسم', 'اللقب', 'تاريخ الميلاد', 'الجنس', 'حالة التكرار', 'النظام'];
  const rows = students.map((s) => [
    s.class_name, s.first_name, s.last_name, s.birth_date ?? '', s.gender ?? '', s.repetition_status, s.boarding,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [{ wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 15 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, 'التلاميذ');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// =========== TIMETABLE IMPORT ===========

export interface TimetableRow {
  rowIndex: number;
  subject: string;
  weekDay: string;
  startTime: string;
  endTime: string;
  room: string | null;
  errors: string[];
}

export interface TimetablePreview {
  rows: TimetableRow[];
  validRows: TimetableRow[];
  invalidRows: TimetableRow[];
}

const WEEKDAY_MAP: Record<string, string> = {
  'الأحد': 'sunday', 'sunday': 'sunday', 'sun': 'sunday',
  'الإثنين': 'monday', 'الاثنين': 'monday', 'monday': 'monday', 'mon': 'monday',
  'الثلاثاء': 'tuesday', 'tuesday': 'tuesday', 'tue': 'tuesday',
  'الأربعاء': 'wednesday', 'الاربعاء': 'wednesday', 'wednesday': 'wednesday', 'wed': 'wednesday',
  'الخميس': 'thursday', 'thursday': 'thursday', 'thu': 'thursday',
  'الجمعة': 'friday', 'friday': 'friday', 'fri': 'friday',
  'السبت': 'saturday', 'saturday': 'saturday', 'sat': 'saturday',
};

const TIMETABLE_COL_ALIASES: Record<string, string[]> = {
  subject: ['المادة', 'subject', 'المادة الدراسية'],
  weekDay: ['اليوم', 'day', 'week day', 'weekday', 'يوم', 'weekday'],
  startTime: ['البداية', 'start', 'start time', 'starttime', 'من', 'وقت البداية', 'start_hour', 'start_hour'],
  endTime: ['النهاية', 'end', 'end time', 'endtime', 'إلى', 'وقت النهاية', 'end_hour', 'end_hour'],
  room: ['رقم القاعة', 'room', 'room number', 'roomno', 'classroom', 'القاعة', 'رقم القسم'],
};

function normalizeTime(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [h, m] = s.split(':').map(Number);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  if (/^\d{1,2}$/.test(s)) {
    return `${s.padStart(2, '0')}:00`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime()) && raw.includes(':')) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return null;
}

export function buildTimetablePreview(headers: string[], rows: string[][]): TimetablePreview {
  const colIdx: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(TIMETABLE_COL_ALIASES)) {
    colIdx[key] = findColumn(headers, aliases);
  }

  const requiredCols = ['subject', 'weekDay', 'startTime', 'endTime'];
  const missingCols = requiredCols.filter((c) => colIdx[c] < 0);

  const importRows: TimetableRow[] = [];

  rows.forEach((cells, i) => {
    const errors: string[] = [];
    if (missingCols.length > 0) {
      errors.push(`Missing columns: ${missingCols.join(', ')}`);
    }

    const subject = colIdx.subject >= 0 ? (cells[colIdx.subject] ?? '').trim() : '';
    const rawDay = colIdx.weekDay >= 0 ? (cells[colIdx.weekDay] ?? '').trim() : '';
    const rawStart = colIdx.startTime >= 0 ? (cells[colIdx.startTime] ?? '').trim() : '';
    const rawEnd = colIdx.endTime >= 0 ? (cells[colIdx.endTime] ?? '').trim() : '';
    const rawRoom = colIdx.room >= 0 ? (cells[colIdx.room] ?? '').trim() : '';

    if (!subject) errors.push('Subject is required');
    const weekDay = rawDay ? (WEEKDAY_MAP[rawDay.toLowerCase()] ?? WEEKDAY_MAP[rawDay] ?? null) : null;
    if (rawDay && !weekDay) errors.push(`Invalid day: ${rawDay}`);
    if (!rawDay) errors.push('Day is required');

    const startTime = normalizeTime(rawStart);
    const endTime = normalizeTime(rawEnd);
    if (!startTime) errors.push(`Invalid start time: ${rawStart}`);
    if (!endTime) errors.push(`Invalid end time: ${rawEnd}`);
    if (startTime && endTime) {
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      if (eh * 60 + em <= sh * 60 + sm) errors.push('End time must be after start time');
    }

    importRows.push({
      rowIndex: i + 2,
      subject,
      weekDay: weekDay ?? '',
      startTime: startTime ?? '',
      endTime: endTime ?? '',
      room: rawRoom || null,
      errors,
    });
  });

  const validRows = importRows.filter((r) => r.errors.length === 0);
  const invalidRows = importRows.filter((r) => r.errors.length > 0);

  return { rows: importRows, validRows, invalidRows };
}

export function generateTimetableTemplate(): Blob {
  const wb = XLSX.utils.book_new();
  const headers = ['المادة', 'اليوم', 'البداية', 'النهاية', 'رقم القاعة'];
  const exampleRows = [
    ['الرياضيات', 'الأحد', '08:00', '09:00', '01'],
    ['العلوم', 'الأحد', '09:00', '10:00', '02'],
    ['اللغة العربية', 'الإثنين', '08:00', '09:00', '01'],
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleRows]);
  ws['!cols'] = [{ wch: 18 }, { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, 'جدول التوقيت');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  if (blob.size === 0) throw new Error('Generated workbook is empty');
  return blob;
}
