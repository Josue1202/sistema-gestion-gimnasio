'use strict';
const db = require('./db');

/**
 * Inicializa y asegura las tablas de la Academia Fitness & Nutrición (inspirada en DocentOS).
 * Si las tablas están vacías, siembra cursos y lecciones profesionales de alto impacto.
 */
async function initAcademiaDb() {
  try {
    // 1. Tabla de Cursos
    await db.query(`
      CREATE TABLE IF NOT EXISTS cursos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        titulo VARCHAR(160) NOT NULL,
        slug VARCHAR(160) UNIQUE NOT NULL,
        categoria VARCHAR(60) NOT NULL,
        descripcion TEXT,
        nivel VARCHAR(40) DEFAULT 'Todos los niveles',
        duracion_estimada VARCHAR(40) DEFAULT '4 semanas',
        icono VARCHAR(60) DEFAULT 'dumbbell',
        es_gratuito BOOLEAN DEFAULT false,
        orden INT DEFAULT 0,
        activo BOOLEAN DEFAULT true,
        creado_en TIMESTAMPTZ DEFAULT now()
      );
    `);

    // 2. Tabla de Lecciones
    await db.query(`
      CREATE TABLE IF NOT EXISTS lecciones (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        curso_id UUID NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
        titulo VARCHAR(180) NOT NULL,
        descripcion TEXT,
        duracion_minutos INT DEFAULT 15,
        video_url TEXT,
        recurso_nombre VARCHAR(120),
        recurso_descarga TEXT,
        es_preview BOOLEAN DEFAULT false,
        orden INT DEFAULT 0,
        activo BOOLEAN DEFAULT true,
        creado_en TIMESTAMPTZ DEFAULT now()
      );
    `);

    // 3. Autenticación de socios (Portal Alumno) y Progreso
    await db.query(`
      ALTER TABLE socios ADD COLUMN IF NOT EXISTS password_hash TEXT;
      ALTER TABLE socios ADD COLUMN IF NOT EXISTS ultimo_login TIMESTAMPTZ;

      CREATE TABLE IF NOT EXISTS lecciones_progreso (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        socio_id UUID NOT NULL REFERENCES socios(id) ON DELETE CASCADE,
        leccion_id UUID NOT NULL REFERENCES lecciones(id) ON DELETE CASCADE,
        completada BOOLEAN DEFAULT true,
        completada_en TIMESTAMPTZ DEFAULT now(),
        UNIQUE(socio_id, leccion_id)
      );

      CREATE TABLE IF NOT EXISTS lecciones_notas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        socio_id UUID NOT NULL REFERENCES socios(id) ON DELETE CASCADE,
        leccion_id UUID NOT NULL REFERENCES lecciones(id) ON DELETE CASCADE,
        contenido TEXT NOT NULL,
        actualizado_en TIMESTAMPTZ DEFAULT now(),
        UNIQUE(socio_id, leccion_id)
      );

      CREATE TABLE IF NOT EXISTS lecciones_consultas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        socio_id UUID NOT NULL REFERENCES socios(id) ON DELETE CASCADE,
        leccion_id UUID NOT NULL REFERENCES lecciones(id) ON DELETE CASCADE,
        pregunta TEXT NOT NULL,
        respuesta TEXT,
        respondida BOOLEAN DEFAULT false,
        creado_en TIMESTAMPTZ DEFAULT now()
      );
    `);

    // 4. Sembrado de cursos si la tabla está vacía
    const cuenta = await db.one('SELECT count(*)::int AS total FROM cursos');
    if (cuenta && cuenta.total === 0) {
      console.log('[academia] Sembrando cursos y lecciones de Nutrición y Gym (DocentOS)...');

      // CURSO 1: Nutrición Deportiva
      const c1 = await db.one(`
        INSERT INTO cursos (titulo, slug, categoria, descripcion, nivel, duracion_estimada, icono, es_gratuito, orden)
        VALUES (
          'Nutrición Deportiva & Composición Corporal',
          'nutricion-deportiva-composicion-corporal',
          'nutricion',
          'Domina el cálculo de macros, déficit calórico para perder grasa sin sacrificar masa muscular y menús estructurados para rendimiento en el gimnasio.',
          'Principiante a Intermedio',
          '3 semanas · 4 lecciones',
          'cup',
          false,
          1
        ) RETURNING id;
      `);

      await db.query(`
        INSERT INTO lecciones (curso_id, titulo, descripcion, duracion_minutos, video_url, recurso_nombre, recurso_descarga, es_preview, orden)
        VALUES
        (
          $1,
          'Fundamentos del Balance Energético & Cálculo Calórico',
          'Aprende a calcular tu gasto calórico basal y tu déficit o superávit según tu objetivo específico.',
          14,
          'https://www.youtube.com/embed/S2oW0jMhWb0',
          'Calculadora_Macros_Excel.pdf',
          'https://drive.google.com',
          true,
          1
        ),
        (
          $1,
          'Distribución de Macros: Proteína, Grasas y Carbohidratos',
          'Cómo repartir tus gramos de proteína por kilogramo de peso corporal y optimizar la recuperación muscular.',
          18,
          'https://www.youtube.com/embed/Xq4j0d4uB3Q',
          'Guia_Gramaje_Proteina.pdf',
          'https://drive.google.com',
          false,
          2
        ),
        (
          $1,
          'Plan de Alimentación para Pérdida de Grasa (Menú Semanal)',
          'Estructura de comidas con alimentos saciantes, recetas rápidas y compras inteligentes en el supermercado.',
          22,
          'https://www.youtube.com/embed/41H7YpZ5l4g',
          'Recetario_Fit_Definicion.pdf',
          'https://drive.google.com',
          false,
          3
        ),
        (
          $1,
          'Timing de Nutrición Peri-Entreno e Hidratación',
          'Qué comer antes y después de entrenar para maximizar la síntesis proteica y no perder energía.',
          16,
          'https://www.youtube.com/embed/P6e1f0e2y80',
          'Protocolo_Hidratacion.pdf',
          'https://drive.google.com',
          false,
          4
        );
      `, [c1.id]);

      // CURSO 2: Hipertrofia & Fuerza
      const c2 = await db.one(`
        INSERT INTO cursos (titulo, slug, categoria, descripcion, nivel, duracion_estimada, icono, es_gratuito, orden)
        VALUES (
          'Guía Maestra de Hipertrofia: Técnica & Sobrecarga',
          'guia-maestra-hipertrofia-fuerza',
          'hipertrofia',
          'Aprende la biomecánica correcta de los levantamientos básicos y cómo aplicar sobrecarga progresiva sin estancarte ni lesionarte.',
          'Intermedio',
          '4 semanas · 4 lecciones',
          'dumbbell',
          false,
          2
        ) RETURNING id;
      `);

      await db.query(`
        INSERT INTO lecciones (curso_id, titulo, descripcion, duracion_minutos, video_url, recurso_nombre, recurso_descarga, es_preview, orden)
        VALUES
        (
          $1,
          'Sobrecarga Progresiva: La Clave Científica del Crecimiento',
          'Cómo registrar tus pesos, repeticiones y volumen de entrenamiento de forma medible semana a semana.',
          15,
          'https://www.youtube.com/embed/Xq4j0d4uB3Q',
          'Hoja_Registro_Cargas.pdf',
          'https://drive.google.com',
          true,
          1
        ),
        (
          $1,
          'Técnica Perfecta en Básicos: Sentadilla, Press Banca y Peso Muerto',
          'Alineación articular, respiración intraabdominal (Valsalva) y posición de pies y escápulas.',
          25,
          'https://www.youtube.com/embed/S2oW0jMhWb0',
          'Checklist_Biomecanica.pdf',
          'https://drive.google.com',
          false,
          2
        ),
        (
          $1,
          'Distribución de Rutinas: Push-Pull-Legs vs Torso-Pierna',
          'Cómo elegir la frecuencia de entrenamiento ideal de acuerdo a tus días disponibles en la semana.',
          20,
          'https://www.youtube.com/embed/41H7YpZ5l4g',
          'Plantillas_Rutinas_PDF.pdf',
          'https://drive.google.com',
          false,
          3
        ),
        (
          $1,
          'Intensidad y RIR: Cuándo Llegar al Fallo Muscular Seguro',
          'Aprende a diferenciar el esfuerzo real del cansancio psicológico para exprimir cada serie.',
          17,
          'https://www.youtube.com/embed/P6e1f0e2y80',
          'Tabla_RIR_Escala.pdf',
          'https://drive.google.com',
          false,
          4
        );
      `, [c2.id]);

      // CURSO 3: Suplementación Deportiva
      const c3 = await db.one(`
        INSERT INTO cursos (titulo, slug, categoria, descripcion, nivel, duracion_estimada, icono, es_gratuito, orden)
        VALUES (
          'Suplementación Basada en Evidencia Científica',
          'suplementacion-basada-en-evidencia',
          'suplementacion',
          'Descubre qué suplementos realmente funcionan con respaldo científico (Creatina, Whey, Cafeína) y cuáles son una pérdida de dinero.',
          'Todos los niveles',
          '2 semanas · 3 lecciones',
          'zap',
          false,
          3
        ) RETURNING id;
      `);

      await db.query(`
        INSERT INTO lecciones (curso_id, titulo, descripcion, duracion_minutos, video_url, recurso_nombre, recurso_descarga, es_preview, orden)
        VALUES
        (
          $1,
          'Creatina Monohidrato & Proteína Whey: Dosis y Mitos',
          'Protocolo de toma, tiempos de saturación, mitos sobre retención de líquidos y daño renal desmentidos.',
          13,
          'https://www.youtube.com/embed/S2oW0jMhWb0',
          'Dosis_Creatina_Guia.pdf',
          'https://drive.google.com',
          true,
          1
        ),
        (
          $1,
          'Cafeína, Pre-Entrenos y Rendimiento de Fuerza',
          'Uso estratégico de estimulantes para no generar tolerancia ni afectar la calidad del sueño profundo.',
          16,
          'https://www.youtube.com/embed/Xq4j0d4uB3Q',
          'Timing_Estimulantes.pdf',
          'https://drive.google.com',
          false,
          2
        ),
        (
          $1,
          'Suplementos Inútiles: Ahorra tu Dinero en el Mostrador',
          'Revisión crítica de quemadores de grasa, BCAAs y potenciadores sin evidencia demostrada.',
          19,
          'https://www.youtube.com/embed/41H7YpZ5l4g',
          'Semáforo_Suplementos.pdf',
          'https://drive.google.com',
          false,
          3
        );
      `, [c3.id]);

      // CURSO 4: Prevención y Movilidad
      const c4 = await db.one(`
        INSERT INTO cursos (titulo, slug, categoria, descripcion, nivel, duracion_estimada, icono, es_gratuito, orden)
        VALUES (
          'Movilidad Articular & Prevención de Lesiones',
          'movilidad-articular-prevencion-lesiones',
          'movilidad',
          'Rutinas de calentamiento activo de 8 minutos para proteger rodillas, hombros y lumbares antes de entrenar pesado.',
          'Todos los niveles',
          '2 semanas · 3 lecciones',
          'check',
          false,
          4
        ) RETURNING id;
      `);

      await db.query(`
        INSERT INTO lecciones (curso_id, titulo, descripcion, duracion_minutos, video_url, recurso_nombre, recurso_descarga, es_preview, orden)
        VALUES
        (
          $1,
          'Protocolo RAMP: Calentamiento Específico en 8 Minutos',
          'Elevación de temperatura, activación de glúteos y movilización de cadera previo al entrenamiento.',
          12,
          'https://www.youtube.com/embed/P6e1f0e2y80',
          'Rutina_RAMP_Grafica.pdf',
          'https://drive.google.com',
          true,
          1
        ),
        (
          $1,
          'Salud del Manguito Rotador y Escápulas para Press',
          'Ejercicios compensatorios para evitar pinzamiento de hombro y tendinitis en press banca y militar.',
          15,
          'https://www.youtube.com/embed/S2oW0jMhWb0',
          'Guia_Hombro_Saludable.pdf',
          'https://drive.google.com',
          false,
          2
        ),
        (
          $1,
          'Dorsiflexión de Tobillo y Descompresión Lumbar',
          'Mejora tu profundidad de sentadilla y descomprime la columna tras series pesadas.',
          14,
          'https://www.youtube.com/embed/Xq4j0d4uB3Q',
          'Descompresion_Columna.pdf',
          'https://drive.google.com',
          false,
          3
        );
      `, [c4.id]);

      console.log('[academia] Cursos y lecciones creados con éxito!');
    }
  } catch (err) {
    console.error('[academia] Error inicializando tablas de cursos:', err.message);
  }
}

module.exports = { initAcademiaDb };
