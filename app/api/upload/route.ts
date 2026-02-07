import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// POST - загрузить файл
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const userId = formData.get('userId') as string

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'Файл не найден' },
        { status: 400 }
      )
    }

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'userId обязателен' },
        { status: 400 }
      )
    }

    // Генерируем уникальное имя файла
    const fileExt = file.name.split('.').pop()
    const fileName = `${userId}/${Date.now()}.${fileExt}`

    // Конвертируем File в ArrayBuffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Загружаем в Supabase Storage
    const { data, error } = await supabase.storage
      .from('achievements')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: false
      })

    if (error) throw error

    // Получаем публичный URL файла
    const { data: urlData } = supabase.storage
      .from('achievements')
      .getPublicUrl(fileName)

    return NextResponse.json({
      success: true,
      data: {
        path: data.path,
        url: urlData.publicUrl
      }
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 400 }
    )
  }
}

// DELETE - удалить файл
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const filePath = searchParams.get('path')

    if (!filePath) {
      return NextResponse.json(
        { success: false, error: 'path обязателен' },
        { status: 400 }
      )
    }

    const { error } = await supabase.storage
      .from('achievements')
      .remove([filePath])

    if (error) throw error

    return NextResponse.json({
      success: true,
      message: 'File deleted successfully'
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 400 }
    )
  }
}