import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // Create admin user
  const adminPassword = await bcrypt.hash("admin123", 10);
  const admin = await prisma.user.upsert({
    where: { email: "admin@ielts.com" },
    update: {},
    create: {
      email: "admin@ielts.com",
      password: adminPassword,
      fullName: "Admin User",
      roles: {
        create: { role: "admin" },
      },
    },
  });
  console.log("✅ Admin user created:", admin.email);

  // Create teacher user
  const teacherPassword = await bcrypt.hash("teacher123", 10);
  const teacher = await prisma.user.upsert({
    where: { email: "teacher@ielts.com" },
    update: {},
    create: {
      email: "teacher@ielts.com",
      password: teacherPassword,
      fullName: "Teacher User",
      roles: {
        create: { role: "teacher" },
      },
    },
  });
  console.log("✅ Teacher user created:", teacher.email);

  // Create student user
  const studentPassword = await bcrypt.hash("student123", 10);
  const student = await prisma.user.upsert({
    where: { email: "student@ielts.com" },
    update: {},
    create: {
      email: "student@ielts.com",
      password: studentPassword,
      fullName: "Student User",
      roles: {
        create: { role: "student" },
      },
    },
  });
  console.log("✅ Student user created:", student.email);

  // Create sample course
  const course = await prisma.course.upsert({
    where: { slug: "ielts-preparation" },
    update: {},
    create: {
      title: "IELTS Preparation Course",
      description: "Complete IELTS preparation with all 4 skills",
      level: "intermediate",
      price: 0,
      isPublished: true,
      slug: "ielts-preparation",
      teacherId: teacher.id,
    },
  });
  console.log("✅ Sample course created:", course.title);

  // Create sample exam
  const exam = await prisma.exam.upsert({
    where: { id: "sample-exam-1" },
    update: {},
    create: {
      id: "sample-exam-1",
      courseId: course.id,
      title: "Week 1 - Listening Practice",
      description: "Practice test for listening skills",
      week: 1,
      durationMinutes: 60,
      isPublished: true,
      examType: "ielts",
    },
  });
  console.log("✅ Sample exam created:", exam.title);

  // Create exam section
  const section = await prisma.examSection.create({
    data: {
      examId: exam.id,
      sectionType: "listening",
      title: "Part 1 - Conversation",
      instructions: "Listen to the audio and answer the questions.",
      orderIndex: 0,
    },
  });
  console.log("✅ Sample section created:", section.title);

  // Create question group
  const group = await prisma.questionGroup.create({
    data: {
      sectionId: section.id,
      title: "Questions 1-5",
      instructions: "Complete the sentences below.",
      orderIndex: 0,
    },
  });
  console.log("✅ Sample question group created");

  // Create sample questions
  await prisma.question.createMany({
    data: [
      {
        groupId: group.id,
        questionType: "fill_blank",
        questionText: "The meeting is scheduled for ___.",
        correctAnswer: "Monday",
        points: 1,
        orderIndex: 0,
      },
      {
        groupId: group.id,
        questionType: "multiple_choice",
        questionText: "What time does the event start?",
        options: JSON.stringify([
          "9:00 AM",
          "10:00 AM",
          "11:00 AM",
          "12:00 PM",
        ]),
        correctAnswer: "10:00 AM",
        points: 1,
        orderIndex: 1,
      },
    ],
  });
  console.log("✅ Sample questions created");

  // Enroll student in course
  await prisma.enrollment.upsert({
    where: {
      courseId_studentId: {
        courseId: course.id,
        studentId: student.id,
      },
    },
    update: {},
    create: {
      courseId: course.id,
      studentId: student.id,
    },
  });
  console.log("✅ Student enrolled in course");

  console.log("\n🎉 Seeding completed!");
  console.log("\n📝 Test accounts:");
  console.log("   Admin:   admin@ielts.com / admin123");
  console.log("   Teacher: teacher@ielts.com / teacher123");
  console.log("   Student: student@ielts.com / student123");
}

main()
  .catch((e) => {
    console.error("❌ Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
