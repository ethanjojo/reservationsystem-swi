-- CreateTable
CREATE TABLE "WorkingWindow" (
    "id" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "WorkingWindow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkingWindow_doctorId_weekday_startMinute_endMinute_key" ON "WorkingWindow"("doctorId", "weekday", "startMinute", "endMinute");

-- AddForeignKey
ALTER TABLE "WorkingWindow" ADD CONSTRAINT "WorkingWindow_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
